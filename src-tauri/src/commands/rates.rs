//! Exchange rates from the European Central Bank.
//!
//! The ECB publishes one small XML file of reference rates, EUR-based, once per
//! working day. It needs no key, has no rate limit, and has kept the same shape
//! for twenty years — which is why this reads it by scanning rather than pulling
//! an XML parser into the build for 1.5 kB of a format that does not change.
//!
//! Two things this deliberately does *not* do:
//!
//!   * it does not triangulate. The file gives units per euro; turning that into
//!     directed pairs is arithmetic, and arithmetic on money belongs in
//!     `src/domain` with `decimal.js`, not here.
//!   * it does not decide what to overwrite. It reports what the ECB said; the
//!     caller keeps the user's own rates intact unless asked otherwise.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;

/// The daily reference file. Stable URL, no key, no query parameters.
const ECB_DAILY_URL: &str = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/// The currencies this app converts between. The rest of the file is ignored.
const WANTED: [&str; 2] = ["USD", "CHF"];

#[derive(Serialize)]
pub struct EcbRates {
    /// Publication date of these rates, `YYYY-MM-DD`.
    pub as_of: String,
    /// Units of each currency per 1 EUR, as the ECB published them.
    pub per_eur: BTreeMap<String, String>,
}

/// Read `key='value'` out of an attribute fragment.
fn attribute<'a>(fragment: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("{key}='");
    let start = fragment.find(&needle)? + needle.len();
    let rest = &fragment[start..];
    let end = rest.find('\'')?;
    Some(&rest[..end])
}

/// Parse the ECB daily file.
///
/// The shape is:
///
/// ```xml
/// <Cube>
///   <Cube time='2026-11-04'>
///     <Cube currency='USD' rate='1.1267'/>
///     <Cube currency='CHF' rate='0.9188'/>
/// ```
pub fn parse_ecb_daily(xml: &str) -> Result<EcbRates, String> {
    let as_of = xml
        .split("time='")
        .nth(1)
        .and_then(|rest| rest.split('\'').next())
        .filter(|date| date.len() == 10 && date.as_bytes()[4] == b'-')
        .ok_or("the ECB file carries no publication date")?
        .to_string();

    let mut per_eur = BTreeMap::new();
    for chunk in xml.split("<Cube currency='").skip(1) {
        let Some(code) = chunk.split('\'').next() else {
            continue;
        };
        if !WANTED.contains(&code) {
            continue;
        }
        let Some(rate) = attribute(chunk, "rate") else {
            continue;
        };
        // A zero or unreadable rate is worse than no rate: it would divide the
        // portfolio by zero somewhere far from here.
        let usable = rate
            .parse::<f64>()
            .map(|value| value.is_finite() && value > 0.0)
            .unwrap_or(false);
        if usable {
            per_eur.insert(code.to_string(), rate.to_string());
        }
    }

    if per_eur.is_empty() {
        return Err("the ECB file carries none of the currencies this app uses".to_string());
    }

    Ok(EcbRates { as_of, per_eur })
}

/// Fetch the ECB's daily reference rates.
#[tauri::command]
pub async fn fetch_ecb_rates() -> Result<EcbRates, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("cannot build the HTTP client: {error}"))?;

    let response = client
        .get(ECB_DAILY_URL)
        .send()
        .await
        .map_err(|error| format!("cannot reach the European Central Bank: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "the European Central Bank answered {}",
            response.status()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("cannot read the ECB answer: {error}"))?;

    parse_ecb_daily(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape of the real file, trimmed to the currencies that matter.
    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
	<Cube>
		<Cube time='2026-11-04'>
			<Cube currency='USD' rate='1.1267'/>
			<Cube currency='JPY' rate='178.30'/>
			<Cube currency='CHF' rate='0.9188'/>
			<Cube currency='GBP' rate='0.83460'/>
		</Cube>
	</Cube>
</gesmes:Envelope>"#;

    #[test]
    fn reads_the_date_and_the_wanted_currencies() {
        let rates = parse_ecb_daily(SAMPLE).expect("the sample parses");
        assert_eq!(rates.as_of, "2026-11-04");
        assert_eq!(rates.per_eur.get("USD").map(String::as_str), Some("1.1267"));
        assert_eq!(rates.per_eur.get("CHF").map(String::as_str), Some("0.9188"));
        // Everything else in the file is ignored rather than carried around.
        assert_eq!(rates.per_eur.len(), 2);
    }

    #[test]
    fn refuses_a_file_without_a_date() {
        let xml = "<Cube><Cube currency='USD' rate='1.1267'/></Cube>";
        assert!(parse_ecb_daily(xml).is_err());
    }

    #[test]
    fn refuses_a_file_without_the_currencies_we_use() {
        let xml = "<Cube><Cube time='2026-11-04'><Cube currency='JPY' rate='178.30'/></Cube></Cube>";
        assert!(parse_ecb_daily(xml).is_err());
    }

    #[test]
    fn ignores_a_zero_rate_rather_than_dividing_by_it_later() {
        let xml = "<Cube><Cube time='2026-11-04'><Cube currency='USD' rate='0'/><Cube currency='CHF' rate='0.9188'/></Cube></Cube>";
        let rates = parse_ecb_daily(xml).expect("CHF is still usable");
        assert!(!rates.per_eur.contains_key("USD"));
    }
}
