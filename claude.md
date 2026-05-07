# RC Celta Avisame Platform

Fan alert system: ONEBOX → signup form → Mailchimp → n8n workflow → Mandrill emails

## Stack
- Frontend: Static HTML + JS (no build)
- APIs: ONEBOX (read-only), Mailchimp (list + tags), Mandrill (email)
- Workflow: n8n (listening to Mailchimp segments, triggering alerts)
- Hosting: GitHub Pages (landing) + Mailchimp + n8n

## Rules
- Never commit `.env` to Git
- ONEBOX: read-only, no writes
- User copy in Spanish, docs in English
- Run `generate-landing.js` after sector changes
- All form validations happen client-side first