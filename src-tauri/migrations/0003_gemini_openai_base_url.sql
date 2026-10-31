-- Point Gemini providers at Gemini's OpenAI-compatible surface.
--
-- The app speaks the OpenAI chat-completions schema everywhere, so a `gemini`
-- provider must call `.../v1beta/openai/chat/completions`, not the native
-- `.../v1beta/chat/completions`. Rows imported from a web backup carry the
-- native URL.

UPDATE llm_providers
   SET base_url = rtrim(base_url, '/') || '/openai',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE provider_type = 'gemini'
   AND rtrim(base_url, '/') LIKE '%/v1beta'
   AND rtrim(base_url, '/') NOT LIKE '%/openai';
