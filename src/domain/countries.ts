/**
 * Countries, for the tax-residence picker.
 *
 * Stored as an ISO 3166-1 alpha-2 code, because the code is stable, compact and
 * unambiguous, while the display name comes from `Intl.DisplayNames`. WebKit has
 * had it since macOS 11.3; when it is missing the code itself is shown, so the
 * picker still works.
 */

/** Every assigned ISO 3166-1 alpha-2 code. */
const CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
  "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
  "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

interface RegionNames {
  of(code: string): string | undefined;
}

// `Intl.DisplayNames` is ES2021 and tsconfig targets ES2020, hence the cast.
const DisplayNames = (
  Intl as unknown as {
    DisplayNames?: new (locales: string[], options: { type: "region" }) => RegionNames;
  }
).DisplayNames;

const regionNames = typeof DisplayNames === "function" ? new DisplayNames(["en"], { type: "region" }) : null;

export interface CountryChoice {
  code: string;
  name: string;
}

function nameOf(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country, sorted by display name. */
export const COUNTRIES: CountryChoice[] = CODES.map((code) => ({ code, name: nameOf(code) })).sort(
  (a, b) => a.name.localeCompare(b.name),
);

/** The display name for a stored code, or the code itself when unknown. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/**
 * `"Switzerland (CH)"` — the form the assistant is given.
 *
 * The code is kept next to the name because models are more reliable with a
 * country it can name from the code (`CH` → Swiss) than with an English label.
 */
export function countryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const name = countryName(code);
  return name === code ? code : `${name} (${code})`;
}
