# OGSM.online for Claude Desktop

A Claude Desktop Extension (`.mcpb`) that lets Claude work with
[OGSM.online](https://ogsm.online) through its API v3, with your own personal
API tokens: canvases, objectives, goals, strategies, indicators, actions,
comments and measurements.

[Nederlands ↓](#nederlands)

## Install

1. Download the latest `ogsm-online-vX.Y.Z.mcpb` from
   [Releases](https://github.com/toolsfactory-nl/ogsm-online-claude-extension/releases).
2. Open the file (double-click it, or drag it onto Claude Desktop), or go to
   **Settings → Extensions** in Claude Desktop and install it from there.
3. Fill in at least one environment in the extension settings (see below).
4. Check that the extension is enabled. Claude Desktop may leave it disabled
   after installing; switch it on under **Settings → Extensions** (called
   **Connectors** in some versions).

At the start of a conversation Claude simply asks: "Which OGSM.online
environment do you want to work in?" You answer with the address you open
OGSM.online on, e.g. `klant.ogsm.online` (see below). Where the app can show a
picker (MCP form *elicitation*), you choose there instead.

Claude Desktop runs the extension with its built-in Node.js; nothing else needs
to be installed.

## Create a personal API token

1. Sign in to your OGSM.online environment, e.g. `https://klant.ogsm.online`.
2. Open **My settings** (`/my_settings/account`) and go to **Personal API tokens**.
   The API has to be enabled for your environment; ask your administrator or
   OGSM.online support if the section is missing.
3. Click **New personal API token**, give it a name (e.g. *Claude on my laptop*),
   choose the access and how long it stays valid:
   - **Read only**: Claude can look things up, but cannot change anything.
   - **Read and write**: Claude can also create and update actions, comments,
     objectives, goals, strategies, indicators and measurements.
4. Copy the token straight away. It is shown only once; treat it like a password.

A token acts with your own permissions: Claude sees and changes exactly what you
can see and change in OGSM.online.

## Configure environments

The extension settings have 10 slots, each a pair of:

- **Environment N: host**: the full host of the environment, e.g.
  `klant.ogsm.online`, or a dedicated server such as `example.ogsm.online`.
  (`https://` and a trailing path are accepted and stripped.)
- **Environment N: personal API token**: the token for that host. Stored as a
  sensitive value: Claude Desktop stores it securely and masks it in the UI.

Fill as many slots as you need and leave the rest empty. Slot 1 is required.

## One environment per conversation

A conversation is about one environment. At the start, Claude asks one short
question, in your language: "Which OGSM.online environment do you want to work
in?" (in Dutch: "In welke OGSM.online-omgeving wil je werken?"), without any
further explanation. You type the address as you know it (e.g.
`klant.ogsm.online`; `https://` and a trailing `/` may be included). It is only
accepted when it matches a configured environment exactly; otherwise Claude
asks again, at most with one generic example (`company.ogsm.online`), and never
names a configured host. Where the
app supports MCP form elicitation, it shows you a picker with your configured
environments (no default) instead. Claude then works in the chosen environment
for the whole conversation. To work in
another environment, **start a new conversation** (a new chat).

## Security model

- **You choose the environment, and Claude never sees the others.** Claude is
  never given the list of configured hosts: you type the host you mean, or
  choose it in the app's own picker where there is one (MCP form elicitation).
  Claude only learns the environment you chose. There is no
  tool that lists environments, and no tool output names another one. This is
  enforced by the extension itself, not only by instructions to Claude:
  - every tool other than `select_environment` refuses to run until an
    environment is selected;
  - `select_environment` always asks you, even when only one environment is
    configured, and never picks one itself. Without a picker it tells Claude to
    ask you one short question and to pass on exactly what you typed, without
    suggesting or guessing a host. A typed host is only accepted on an exact match (ignoring
    case, `https://` and a trailing `/`); the refusal names no configured host,
    and after 5 misses in 10 minutes further attempts are refused for a while,
    so the configured hosts cannot be probed. With a picker, a host from Claude
    is refused;
  - `select_environment` hands out a random `environment_session` that is bound
    to the chosen environment and that every other tool must pass. It only
    exists in the conversation where you made the choice, so a new conversation
    has to choose again, and an idle selection expires after 12 hours;
  - while the conversation's `environment_session` is valid, `select_environment`
    refuses a second selection and says to start a new conversation.
- **Read versus write.** Use a *Read only* token when Claude only needs to look
  things up. Any change with a read only token is refused by OGSM.online with
  `read_only_token`, and Claude tells you so.
- **Tokens stay on your computer.** They are only sent, as
  `Authorization: Bearer …`, to `https://<host>/api/v3/…` of the environment they
  belong to, and never appear in tool output.

## Tools

> **Note:** the tools for objective, strategy and action reports, measurements
> (single and batch), the `page` parameter and some card fields use parts of API
> v3 that are new. They need an environment that runs the latest OGSM.online
> version; on an older one they answer "not found".

| Tool | What it does |
| --- | --- |
| `select_environment` | Let you choose the environment for this conversation |
| `list_canvases`, `list_teams`, `list_users`, `list_statuses` | Read canvases, teams, users and action statuses |
| `list_actions`, `create_action`, `update_action` | Actions (`strategy_id` of a strategy or action as parent; `list` sets the status) |
| `list_comments`, `create_comment`, `update_comment`, `delete_comment` | Comments on a card |
| `list_objectives`, `create_objective`, `update_objective` | Objectives (no parent) |
| `list_goals`, `create_goal`, `update_goal` | Goals (`parent_id` of a goal makes a sub goal) |
| `list_strategies`, `create_strategy`, `update_strategy` | Strategies (no parent) |
| `list_indicators`, `create_indicator`, `update_indicator` | Indicators (`parent_id` of a strategy or indicator is required) |
| `list_objective_reports`, `list_strategy_reports`, `list_action_reports` | Reports of objectives, strategies and actions (read only) |
| `list_goal_reports`, `list_indicator_reports` | Measurements of goals and indicators |
| `create_/update_/delete_goal_report`, `create_/update_/delete_indicator_report` | Add, change or delete one measurement |
| `create_goal_report_batch`, `create_indicator_report_batch` | Up to 500 measurement changes in one asynchronous batch |
| `get_goal_report_batch`, `get_indicator_report_batch` | Status and results of a batch |

List tools fetch all pages (1500 records each), or only one with `page`.

- Descriptions and comments are HTML; an `<img>` with a base64 data URI as its
  `src` is stored as an attachment. When editing, the full HTML is sent back, or
  attachments are lost.
- `label_ids` replaces the whole set of labels (`[]` clears them).
- The canvas and parent are set on create only: a card can't be moved or deleted
  through the API.
- Traffic lights are in the language of the environment: `groen`/`oranje`/`rood`
  (nl) or `green`/`amber`/`red` (en); `""` or `null` clears one.
- Errors from the API (such as 403 `read_only_token`, 404 or 422 validation
  errors) are returned to Claude as short readable messages.

## Development

```bash
npm ci
npm test                 # environment gate, request building (mocked fetch), MCP round trip
npm run validate         # validate manifest.json against the MCPB spec
npm run sync-tools       # after changing tools: copy names/descriptions into manifest.json
```

Run the server by hand with `OGSM_ENV_1_HOST=… OGSM_ENV_1_TOKEN=… node server/index.js`
(it speaks MCP over stdio). There is no build step.

### Release

1. Bump `version` in `manifest.json`, `package.json` and `package-lock.json`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.

GitHub Actions runs the tests, packs the extension with `node scripts/pack.js`
and attaches `ogsm-online-v0.2.0.mcpb` to a new GitHub Release.

`npm run pack` builds the same package locally: it copies the extension to a
staging directory, installs production dependencies only there
(`npm ci --omit=dev`) and runs `mcpb pack` on it, so devDependencies never end
up in the `.mcpb`. `.mcpbignore` also leaves out TypeScript sources, type
definitions, source maps and docs from `node_modules`.

---

## Nederlands

Een Claude Desktop-extensie (`.mcpb`) waarmee Claude via de API v3 met
[OGSM.online](https://ogsm.online) werkt, met je eigen persoonlijke API-tokens:
OGSM's, ambities, doelstellingen, strategieën, KPI's, acties, reacties en
metingen.

### Installeren

1. Download de nieuwste `ogsm-online-vX.Y.Z.mcpb` bij
   [Releases](https://github.com/toolsfactory-nl/ogsm-online-claude-extension/releases).
2. Open het bestand (dubbelklikken, of naar Claude Desktop slepen), of installeer
   het via **Instellingen → Extensies** in Claude Desktop.
3. Vul in de instellingen van de extensie minstens één omgeving in (zie
   hieronder).
4. Controleer of de extensie aanstaat. Claude Desktop kan haar na het
   installeren uitgeschakeld laten; zet haar aan via **Instellingen →
   Extensies** (in sommige versies **Connectors**).

Aan het begin van een gesprek vraagt Claude gewoon: "In welke
OGSM.online-omgeving wil je werken?" Je antwoordt met het adres waarop je
OGSM.online opent, bijvoorbeeld `klant.ogsm.online` (zie hieronder). Waar de app
een keuzelijst kan tonen (MCP-formulier-*elicitation*), kies je daar.

Claude Desktop draait de extensie met de ingebouwde Node.js; je hoeft verder
niets te installeren.

### Een persoonlijk API-token maken

1. Log in op je OGSM.online-omgeving, bijvoorbeeld `https://klant.ogsm.online`.
2. Open **Mijn instellingen** (`/my_settings/account`) en ga naar
   **Persoonlijke API-tokens**. De API moet aanstaan voor je omgeving; vraag je
   beheerder of de support van OGSM.online als dit onderdeel ontbreekt.
3. Klik op **Nieuw persoonlijk API-token**, geef het een naam (bijvoorbeeld
   *Claude op mijn laptop*) en kies de toegang en hoe lang het geldig is:
   - **Alleen lezen**: Claude kan dingen opzoeken, maar niets wijzigen.
   - **Lezen en wijzigen**: Claude kan ook acties, reacties, ambities,
     doelstellingen, strategieën en KPI's aanmaken en bijwerken.
4. Kopieer het token meteen. Je ziet het maar één keer; behandel het als een
   wachtwoord.

Een token werkt met jouw rechten: Claude ziet en wijzigt precies wat jij in
OGSM.online mag zien en wijzigen.

### Omgevingen instellen

De instellingen van de extensie hebben 10 plekken, elk een paar van:

- **Environment N: host**: de volledige host van de omgeving, bijvoorbeeld
  `klant.ogsm.online`, of een eigen server zoals `example.ogsm.online`.
- **Environment N: personal API token**: het token voor die host. Claude
  Desktop bewaart het veilig als gevoelige waarde en toont het gemaskeerd.

Vul zoveel plekken in als je nodig hebt en laat de rest leeg. Plek 1 is verplicht.

### Eén omgeving per gesprek

Een gesprek gaat over één omgeving. Aan het begin stelt Claude één korte vraag,
in jouw taal: "In welke OGSM.online-omgeving wil je werken?", zonder verdere
uitleg. Je typt het adres zoals jij het kent (bijvoorbeeld `klant.ogsm.online`;
`https://` en een `/` aan het eind mogen erbij). Dat wordt alleen geaccepteerd
als het precies overeenkomt met een ingestelde omgeving; anders vraagt Claude
het nog eens, hooguit met één algemeen voorbeeld (`bedrijf.ogsm.online`), en
noemt nooit een ingestelde host. Ondersteunt de app MCP-formulier-elicitation,
dan toont die je in plaats daarvan een keuzelijst met je ingestelde omgevingen
(zonder standaardwaarde). Claude werkt daarna het hele gesprek in de gekozen
omgeving. Wil je in een andere
omgeving werken, **begin dan een nieuw gesprek** (een nieuwe chat).

### Beveiliging

- **Jij kiest de omgeving, en Claude ziet de andere niet.** Claude krijgt de
  lijst met ingestelde hosts nooit: jij typt de host die je bedoelt, of kiest
  hem in de eigen keuzelijst van de app als die er is (MCP-formulier-
  elicitation). Claude krijgt alleen de omgeving te horen die jij koos. Er
  is geen tool die omgevingen opsomt, en geen uitvoer van een tool noemt een
  andere omgeving. De extensie dwingt dat zelf af, niet alleen via instructies
  aan Claude:
  - elke tool behalve `select_environment` weigert totdat er een omgeving is
    gekozen;
  - `select_environment` vraagt het altijd aan jou, ook als er maar één
    omgeving is ingesteld, en kiest nooit zelf. Zonder keuzelijst zegt het
    Claude dat het jou één korte vraag moet stellen en precies moet doorgeven
    wat jij typte, zonder een host voor te stellen of te raden. Een getypte host wordt alleen
    geaccepteerd als hij precies overeenkomt (hoofdletters, `https://` en een
    `/` aan het eind tellen niet mee); de weigering noemt geen ingestelde host,
    en na 5 missers in 10 minuten worden verdere pogingen een tijd geweigerd,
    zodat de ingestelde hosts niet af te tasten zijn. Met een keuzelijst wordt
    een host van Claude geweigerd;
  - `select_environment` geeft een willekeurige `environment_session` die aan
    de gekozen omgeving vastzit en die elke andere tool moet meegeven. Die
    bestaat alleen in het gesprek waarin je de keuze maakte, dus in een nieuw
    gesprek kies je opnieuw; na 12 uur zonder gebruik vervalt de keuze;
  - zolang de `environment_session` van het gesprek geldig is, weigert
    `select_environment` een tweede keuze en zegt het dat je een nieuw gesprek
    moet beginnen.
- **Lezen tegenover wijzigen.** Gebruik een token met *Alleen lezen* als Claude
  alleen hoeft op te zoeken. Een wijziging met zo'n token weigert OGSM.online
  met `read_only_token`, en Claude laat je dat weten.
- **Tokens blijven op je computer.** Ze gaan alleen, als
  `Authorization: Bearer …`, naar `https://<host>/api/v3/…` van de omgeving
  waar ze bij horen, en staan nooit in de uitvoer van een tool.

### Tools

> **Let op:** de tools voor rapportages van ambities, strategieën en acties,
> metingen (los en in batches), de parameter `page` en een deel van de
> kaartvelden gebruiken nieuwe delen van API v3. Daarvoor moet de omgeving de
> nieuwste versie van OGSM.online draaien; een oudere geeft "not found".

| Tool | Wat hij doet |
| --- | --- |
| `select_environment` | Laat je de omgeving voor dit gesprek kiezen |
| `list_canvases`, `list_teams`, `list_users`, `list_statuses` | Canvassen, teams, gebruikers en actiestatussen lezen |
| `list_actions`, `create_action`, `update_action` | Acties (`strategy_id` van een strategie of actie als ouder; `list` zet de status) |
| `list_comments`, `create_comment`, `update_comment`, `delete_comment` | Reacties op een kaart |
| `list_objectives`, `create_objective`, `update_objective` | Ambities (geen ouder) |
| `list_goals`, `create_goal`, `update_goal` | Doelstellingen (`parent_id` van een doelstelling maakt een subdoelstelling) |
| `list_strategies`, `create_strategy`, `update_strategy` | Strategieën (geen ouder) |
| `list_indicators`, `create_indicator`, `update_indicator` | Indicatoren (`parent_id` van een strategie of indicator is verplicht) |
| `list_objective_reports`, `list_strategy_reports`, `list_action_reports` | Rapportages van ambities, strategieën en acties (alleen lezen) |
| `list_goal_reports`, `list_indicator_reports` | Metingen van doelstellingen en indicatoren |
| `create_/update_/delete_goal_report`, `create_/update_/delete_indicator_report` | Eén meting toevoegen, wijzigen of verwijderen |
| `create_goal_report_batch`, `create_indicator_report_batch` | Tot 500 metingwijzigingen in één asynchrone batch |
| `get_goal_report_batch`, `get_indicator_report_batch` | Status en resultaten van een batch |

`label_ids` vervangt alle labels; een kaart verplaatsen of verwijderen kan niet
via de API. Stoplichten volgen de taal van de omgeving (`groen`/`oranje`/`rood`
of `green`/`amber`/`red`); `""` of `null` wist er een. HTML-tekst stuur je bij
bewerken volledig terug, anders gaan bijlagen verloren.

Zie de Engelse tekst hierboven voor ontwikkelen en releasen.

## License

[ISC](LICENSE)
