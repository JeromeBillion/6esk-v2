https://github.com/JeromeBillion/6esk.git

Building 6esk’s Two‑Way Email System (Sending, Receiving & Storage)

Overview: We need to architect a Gmail-style email layer inside the 6esk CRM. This means users can send emails from addresses like name@6ex.co.za and receive replies directly in 6esk. Key requirements include: native sending/receiving in the app, easy provisioning of new staff addresses, reliable storage of all emails (possibly via Cloudflare), and keeping costs low by avoiding expensive enterprise email suites. We’ll compare feasible infrastructure options (Mailgun, ImprovMX, ForwardEmail, Resend, Cloudflare Workers, or self-hosted) and recommend a complete solution. The final plan will prioritize low-cost, developer-friendly tools while explaining trade-offs in deliverability, reliability, and scalability.

Requirements & Goals

Two-Way Email Integration: 6esk users should send and receive emails entirely within the CRM (no external email client needed), similar to Gmail’s experience.

Custom Domain Sending: Emails should come from the company’s domain (e.g. jerome.choma@6ex.co.za), not a third-party domain. We’ll set up SPF/DKIM so that these emails are trusted.

Inbound Email Capture: All emails sent to any *@6ex.co.za address must route into the 6esk app so staff can read and reply. This requires configuring MX records for the domain and an inbound processing service.

Automatic Address Provisioning: When a new staff user is added in 6esk, they should instantly have an email address (no manual mailbox creation). Conversely, if someone leaves, we don’t delete their address (to avoid bounces that hurt domain reputation). Instead we can leave it as an alias or catch-all so emails to old addresses aren’t lost.

Reliable Storage: Every sent and received email needs to be stored (bodies, attachments) reliably for later retrieval, ideally under our control. The solution should use a durable storage (considering Cloudflare R2 object storage or our database) to retain emails long-term.

Low Cost & Control: Favor solutions that are affordable or free at low volumes, with developer-friendly APIs and minimal lock-in. Avoid “enterprise” email providers (Google Workspace, Office 365) in favor of building on APIs or open-source tools where possible. We own the 6ex.co.za domain and will manage DNS records, so we can integrate any service that relies on DNS (SPF, DKIM, MX, etc.).

Deliverability: Ensure high deliverability for outbound emails (using reputable sending IPs, proper authentication records, and possibly BIMI for brand recognition). Also handle inbound spam appropriately so it doesn’t overwhelm our CRM.

High-Level Architecture

Figure: End-to-end email flow for 6esk CRM. Outbound (bottom): a CRM user sends an email via the Resend API, which delivers it to the recipient’s inbox. Inbound (top): an external sender’s email to *@6ex.co.za hits our domain’s MX (mail exchanger) service. That service (e.g. Resend Inbound or Cloudflare Email Workers) forwards the message to a webhook or function in our system. The 6esk backend processes the email and stores it (e.g. in a database or Cloudflare R2 storage). Finally, the email appears in the CRM UI for the user to read and reply.

In this architecture, 6esk acts as a mini email client+server:

For sending, 6esk will call an email sending API (like Resend) which then handles the actual SMTP delivery out to recipients on the internet.

For receiving, we configure the DNS MX records of 6ex.co.za to point to an inbound email processing service. That service catches incoming emails and calls our CRM (via webhook) with the email data. 6esk then saves the email and displays it in the UI.

Storage of emails is within 6esk’s control (our database or cloud storage), not left with the email service. This ensures we have full access to all message history and can link emails to CRM records (contacts, tickets, etc.).

User addresses can be managed with catch-all routing – any address at our domain will be accepted and forwarded to 6esk. This means simply adding a user in 6esk “provisions” their email address; no separate mailbox creation step on an email server is needed. We’ll keep old addresses active (or forwarded) to avoid bouncing emails.

Next, we’ll examine concrete options for each piece (outbound sending, inbound receiving, and storage), comparing services and approaches.

Outbound Email Sending (Using Resend API)

For sending emails, Resend is a strong choice given its developer-centric design and reasonable pricing. Resend provides a simple API/SMTP service to send emails and manage templates, with a focus on great developer experience. It’s similar to services like SendGrid or Mailgun but newer and very streamlined. Benefits of using Resend for sending include:

Easy Integration: Resend’s API can be called from our backend to send emails (or even via SMTP relay). It has official SDKs and is built to “just work” for developers. This fits a modern stack like 6esk.

Domain Authentication: We’ll add DNS records that Resend provides (SPF and DKIM) for 6ex.co.za. This proves to recipients that Resend is allowed to send on behalf of our domain, improving deliverability. Resend helps manage these records and uses “pristine” shared IPs or even dedicated IPs (on higher plans) to keep spam scores low.

Deliverability & Speed: Resend (and similar APIs) handle the nitty-gritty of email delivery – queuing, retries, and feedback loops for bounces or spam complaints. They aim for high inbox placement. Resend’s infrastructure is globally distributed for fast delivery. (In practice, Resend is built on AWS SES under the hood, according to community info, so reliability is high.)

Cost: Resend has a free tier (up to 100 emails/day) and then usage-based pricing. For example, their “Pro” plan (around $20/month) lifts the daily limit and allows more domains. Pricing per email is comparable to other APIs (on the order of fractions of a cent per email). This is far cheaper than providing each user a Google Workspace seat, for instance. We only pay for the emails we actually send.

Features: We get support for scheduling emails, batch sending, open/click tracking, etc. (optional). Those aren’t core to MVP but are nice for a CRM (e.g. tracking if a client opened an email). Resend supports webhooks for events (delivered, bounced, etc.) if we need to log those.

Alternative Sending Options: We could use another email API (Mailgun, SendGrid, Amazon SES) similarly. Mailgun, for example, is a mature option with good deliverability, but its pricing can be higher at scale and it may be slightly more complex to work with (older UI and concepts). Since Resend is already chosen for its simplicity, we’ll proceed with that for outbound. (ImprovMX offers an SMTP sending feature on paid plans, but it’s limited and intended for small-scale use – our volume may outgrow that 6,000 emails/month limit on their $9 plan. Resend or similar APIs are more scalable.)

Outbound Setup: We will configure Resend by verifying our 6ex.co.za domain in Resend’s dashboard and adding the provided DNS records (SPF, DKIM, and a custom Mail-From subdomain if they require). Once verified, any email sent via Resend’s API with From: user@6ex.co.za will be signed and authorized. In 6esk’s backend, when a user hits “Send” on an email, we call Resend’s API (with our API key) including the from, to, subject, and HTML/text content. Resend will queue and send the message out. We should also set up a webhook for delivery events (e.g. to mark messages as delivered or bounced in the CRM). Resend allows one webhook endpoint on the free plan (more on higher plans).

BIMI (Optional): Since we own our domain, we can configure BIMI if desired. BIMI involves publishing a DNS record pointing to an SVG of our logo and having a proper DMARC policy in place. It’s optional, but if we want our 6esk logo to appear in supporting email clients (like Gmail) next to messages, BIMI would enable that. It requires that we’re already authenticating with SPF/DKIM and using DMARC. We can consider this a nice-to-have once basic deliverability is solid.

In summary, Resend covers our sending needs: it’s cost-effective, easy to use, and offloads the complex parts of email delivery. Next, we tackle the harder part: receiving emails and storing them.

Inbound Email Receiving & Routing Options

Handling incoming emails to our domain is challenging because we effectively need a Mail Transfer Agent (MTA) for 6ex.co.za. We have several options here, ranging from third-party services that receive and forward emails, to building a lightweight mail server ourselves. We’ll compare the main candidates:

Option 1: Resend Inbound (Webhooks)

Option 2: Mailgun Routes (Inbound API)

Option 3: Email Forwarding Services (ImprovMX or ForwardEmail)

Option 4: Cloudflare Email Routing + Workers

Option 5: Self-Hosted Email Server (IMAP/SMTP)

Each option will get emails addressed to *@6ex.co.za and deliver them to our 6esk application (or store them for us to fetch). Let’s break down how each works and their pros/cons.

Option 1: Resend Inbound (Webhook Events)

Interestingly, Resend now supports inbound email processing in addition to sending. With Resend Inbound, we’d point our domain’s MX record to Resend’s servers. Resend will catch any email to our domain, parse it (split headers, body, attachments), and then send an HTTP webhook POST to our specified endpoint with the email data in JSON. This is very similar to how Mailgun or SendGrid handle inbound.

How it works: We configure Resend by adding an MX record (mail exchanger) for 6ex.co.za pointing to Resend’s inbound server address. According to Resend’s docs, once the MX is in place, any address at that domain will be accepted (catch-all). For example, if someone emails alice@6ex.co.za or support@6ex.co.za, Resend will process it the same way. We also set up a “Receiving” webhook in Resend’s dashboard (pointing to an endpoint in our app, e.g. https://our-crm.com/api/inbound-email). Now, when an email comes in:

Resend receives it and immediately responds to the sender’s server (so the sender sees a successful delivery).

It then parses the email into a JSON event (with fields like sender, recipient, subject, text, HTML, and attachment metadata).

Resend sends this JSON to our webhook (event.type = "email.received"). We can reply with 200 OK and process the data (e.g. save to DB).

If our webhook is down or returns non-200, Resend will queue and retry the webhook a few times, so we don’t lose the email. (Resend also stores inbound messages in their dashboard for some days – on the free plan data retention is 1 day, Pro 3 days – allowing us to manually fetch if needed.)

Pros: Using Resend for inbound means one unified service for all email. This simplifies setup (we manage one set of credentials and dashboard). It’s developer-friendly and webhook-based, which fits naturally with a web app like 6esk. We get guaranteed catch-all routing without extra configuration. They also handle parsing attachments (storing them temporarily for us to download via the API if needed). Another benefit is reliability – as noted, Resend queues inbound events if our server is down, and we can retrieve messages from their API. This safety net is great for production robustness.

Cons: Relying on Resend for inbound means we’re somewhat locked into that vendor for both send+receive. If their pricing or policies change, moving off would require switching MX and our webhook integration to a new system. Cost-wise, Resend’s pricing for inbound is not clearly separate – it likely counts toward a monthly plan’s usage. There may be limits on inbound volume for free tiers, etc. (Resend hasn’t publicized per-inbound email costs, but assuming they align with general usage-based pricing). Another consideration: Resend is relatively new, so their inbound service might not be as battle-tested as, say, Mailgun’s. However, the fundamentals (receiving via MX, webhooks) are standard.

Overall, Resend Inbound is a convenient choice especially since we intend to use Resend for sending. It keeps things simple and integrated. We’d essentially connect Resend’s webhook to a handler in 6esk that saves the email to our storage.

Option 2: Mailgun Routes (Inbound)

Mailgun is a long-established email service that, in addition to sending, provides inbound email routing via their “Routes” feature. We could use Mailgun just for receiving (and still use Resend for sending, or even use Mailgun for both). In this setup, we’d add an MX record for a Mailgun subdomain or use our domain with Mailgun’s servers, and define a route that forwards all emails to an HTTP endpoint.

How it works: We set up a domain in Mailgun (e.g. a subdomain like inbound.6ex.co.za or the root domain). Then we configure Routes with patterns – e.g. a catch-all route using Mailgun’s match_recipient(".*@6ex.co.za") filter – and an action to forward() to our webhook URL. When Mailgun receives an email for our domain, it checks the routes: our catch-all route will match and trigger the forward action. The email is parsed and posted to our endpoint in JSON (similar to Resend’s payload). We can also add a store() action in Mailgun which keeps a copy of the email on Mailgun’s servers for 3 days – a nice backup in case we need to retrieve it via Mailgun’s API.

Mailgun’s inbound parsing automatically strips signatures/quotes if we want, and can even be configured to strip attachments or handle them separately. It basically acts as an email parser and can simplify the incoming content.

Pros: Mailgun is a proven platform used by many businesses for email. It has robust infrastructure and can scale to high volumes. Inbound routing is quite flexible – you can set multiple routes (e.g. specific addresses go to different endpoints or mailboxes, etc.). It will convert emails to UTF-8 JSON with all the data for easy processing. Mailgun also offers logs and analytics for inbound events, and the temporary storage feature ensures we don’t lose emails if our endpoint was down (similar to Resend’s retry mechanism).

Another pro is that Mailgun could also send emails; in future if we wanted a single vendor, we could consolidate on Mailgun. They have features like spam filtering (you can enable a spam filter for inbound to drop obvious spam). This might save our CRM from having to handle all junk messages.

Cons: Mailgun’s cost structure might be a downside for a lean setup. They have a free tier for 3 months; afterward, it becomes pay-as-you-go (e.g. $1/1000 messages). If our email volume grows, we could incur monthly fees. Also, using Mailgun just for inbound while using Resend for outbound means juggling two services. It’s doable but slightly more complex (two dashboards, two sets of API keys). There’s also a bit more setup: we must define routes either via their dashboard or API, whereas Resend auto-captures all addresses by default.

Mailgun’s vendor lock-in is moderate – switching away later means updating MX records and possibly rewriting parts of our webhook handler if we relied on Mailgun-specific JSON fields or parsing (though most providers give similar data). It’s an older service, so the developer experience might feel a bit more clunky compared to Resend’s modern approach (as anecdotal feedback suggests).

Summary: Mailgun inbound is reliable and feature-rich. If Resend inbound wasn’t available or if we wanted a more established solution, Mailgun is a top choice. We would use it in a similar webhook fashion. However, given our desire to minimize cost and complexity, we might prefer newer or free alternatives for inbound if they meet our needs.

Option 3: Email Forwarding Services (ImprovMX or ForwardEmail)

Another approach is to use an email forwarding service that specializes in routing domain emails. These services (e.g. ImprovMX and ForwardEmail) don’t store mail long-term; they forward incoming emails to other addresses or even to webhooks. They are often used to forward mail to a personal inbox, but they also support forwarding to a webhook/URL for programmatic handling.

ImprovMX: This is a popular free service for custom domain email forwarding. On the free tier, ImprovMX lets you handle 1 domain, with up to 25 email aliases, and forward up to 500 emails/day. It also supports catch-all addresses and wildcard aliases. Critically, ImprovMX supports webhooks on all plans (even free). We can configure it such that every incoming email triggers a webhook to our 6esk endpoint (instead of forwarding to an external inbox). The content comes as a structured JSON payload for easy processing. This essentially gives us inbound email handling at no cost (until we scale past the free tier limits).

To set it up, we’d point MX records for 6ex.co.za to ImprovMX’s servers (mx1.improvmx.com etc.). In ImprovMX dashboard, set a routing rule: either a catch-all alias that sends to a webhook address, or use their “Rules Routing” feature to send everything to webhook. ImprovMX can also forward to multiple destinations at once; for instance, we could send a copy to a backup email address and to our webhook if desired.

ForwardEmail: This is an open-source alternative to ImprovMX. You can use their hosted service (with a free tier) or even self-host it since it’s open source. ForwardEmail offers similar capabilities: catch-all forwarding, and even an optional encrypted mailbox storage on paid plans (more on that shortly). They also have a webhook feature to POST emails to your server. One unique aspect: ForwardEmail’s paid plans can function as a lightweight email hosting – providing IMAP/POP3 access to stored emails. For example, for $3/month you get a 10GB mailbox and can actually receive mail into ForwardEmail’s storage instead of forwarding it. That’s more like a traditional email account, except oriented to privacy and devs.

For our architecture, we likely wouldn’t use the hosted mailbox feature (since we want emails in our database, not someone else’s). But it’s worth noting as an option – ForwardEmail could hold the emails and 6esk could fetch them via IMAP. However, that reintroduces external mailstore complexity and less control. We prefer to receive and store ourselves via webhook.

Pros (ImprovMX/ForwardEmail): These services are simple and affordable. ImprovMX’s generous free tier could cover our startup phase at essentially no cost. It’s literally designed to be a “set and forget” solution to catch emails and deliver them elsewhere. Both support catch-all routing (so new addresses work automatically) and have minimal setup beyond DNS. They also don’t impose big vendor lock-in – since they’re mostly just relaying emails, we could switch to another forwarder easily by changing MX records. ForwardEmail being open-source is a plus for long-term control: if needed, we could try hosting our own instance (though that’s non-trivial, the option exists).

Another benefit: these services often handle basic spam filtering and forwarding quirks. For example, ImprovMX has a good reputation for not getting flagged as spam when forwarding. They implement SRS (Sender Rewriting) so that forwarded emails pass SPF checks, etc. They also provide logs to troubleshoot if an email didn’t arrive.

Cons: The main limitation is that these services do not store emails – they only relay them. So if our webhook endpoint is down and the forwarder can’t deliver to it, the email could bounce or be dropped. (ImprovMX does support retries to webhooks, but ultimately it’s not an inbox storage service. We’d have to rely on the sender to retry or have a backup forward-to-email.) In other words, there’s a bit less guarantee compared to Resend/Mailgun which queue messages for later retrieval. We should design our webhook to be highly available to not lose mails.

Additionally, while ImprovMX is free for moderate use, if we grow or need more aliases/domains, we might upgrade ($9/mo plan supports 30 domains and higher limits). ForwardEmail’s free tier is also quite good (unlimited domains and aliases, since it’s donation-supported), but for using IMAP storage or higher sending limits they charge a small fee.

Support and polish might be another factor: ImprovMX is praised for simplicity and support, whereas ForwardEmail (according to ImprovMX’s comparison) might have a “clunky interface” and less responsive support. This may or may not matter for us if everything runs smoothly.

In summary, ImprovMX or ForwardEmail provides a lightweight inbound solution where the email is instantly piped into our system via a webhook. It’s cost-effective and keeps us in control of storage (since we’ll handle storing the JSON payload content). We’ll need to ensure high uptime on our end to not miss emails, or perhaps configure a secondary failover (like forward to a backup Gmail as well, just in case).

Option 4: Cloudflare Email Routing + Workers

Cloudflare offers an Email Routing service (free) which can receive emails for a domain and either forward them to another address or route them to a Cloudflare Worker (a serverless function). This is a very developer-centric approach: it effectively lets us run custom code whenever an email arrives, and we can then do anything with that email – store it, inspect it, etc. The appeal here is maximum control at potentially zero cost, leveraging Cloudflare’s network.

How it works: We enable Cloudflare Email Routing for 6ex.co.za in our Cloudflare dashboard (since we own the domain, presumably managed in Cloudflare DNS). We set the domain’s MX records to Cloudflare’s inbound mail servers. Then we create an “Email Worker” script – this is Cloudflare Worker code with an email event handler (instead of HTTP). Cloudflare will catch all emails to our domain (we can specify catch-all or specific addresses in the routing rules) and invoke our Worker with the email content. Within the Worker, we get an EmailMessage object which includes the raw email or MIME parts. We can parse it (Cloudflare might have some helper to extract common fields, or we use a library), and then for example, write the email to storage.

Cloudflare has R2 (S3-compatible object storage) and KV/Durable Objects/D1 (databases) that our Worker can interact with. A proven approach (from a Cloudflare blog/Medium post) is to use Workers KV for email metadata and R2 to store the raw email blob or attachments. In fact, an engineer built a prototype called “ElasticInbox for Cloudflare” which implements a simple mailstore on top of Workers + R2. We could use such a pattern: when an email arrives, our Worker stores the email content in R2 (e.g. emails/<user>/<message-id>.eml) and maybe writes a small record in a KV or D1 database with the message’s headers (to list in UI).

The Worker could also directly call our 6esk backend webhook instead, but doing the processing in Cloudflare has advantages: it’s extremely fast (no external HTTP call) and Cloudflare can retry or queue automatically via durable objects or queues. Essentially, we are building a tiny mail server within our Cloudflare stack.

Pros: This option offers full ownership of the inbound pipeline. No third-party (besides Cloudflare infrastructure) is handling the mail – we define exactly how to process it. Cloudflare’s global network means reliability and scalability; it can handle huge volumes of email and invoke our Worker without us managing any servers. The cost is minimal: Cloudflare Email Routing is free, Workers have a free tier (100k requests per day) which is plenty for email volume, and R2 storage is very cheap (and also has a free allowance). We could potentially run this at near $0 cost monthly.

Another big plus is long-term feasibility: Cloudflare is even launching a dedicated Email Service (in beta, as of late 2025) that integrates sending and receiving in Workers. They are focusing on automatically setting up SPF/DKIM and high deliverability, competing with SES/Resend. This means our solution would be on a forward-looking platform – we could eventually migrate sending to Cloudflare too, making the CRM email fully on Cloudflare’s stack if desired. The integration with our domain’s DNS is seamless (Cloudflare can auto-add needed records, etc.).

Cons: The drawback is development complexity. We (or a developer on our team) would need to write and maintain the Cloudflare Worker code to handle emails and integrate storage. While examples and even open-source projects exist (ElasticInbox for Cloudflare is open source on GitHub), this is more coding than using a turnkey service like Resend or ImprovMX. We’d need to carefully implement parsing (though Cloudflare Workers support an Email message API for parsing headers, and can stream the body, etc.), and ensure we don’t run into limits (Workers have a 10ms CPU time limit on free tier, 50ms on paid – processing an email should normally be fine within that).

Another consideration is that Cloudflare’s email routing does not itself do spam filtering. We would receive everything, including spam. We might need to implement or integrate a spam detection (there is a mention of using “Workers AI” to classify emails or a community example using an AI spam score via Workers). This is an extra effort, although initially we could simply mark all incoming emails and perhaps later integrate something like SpamAssassin rules in the Worker or an API to classify spam.

Summary: Cloudflare Workers approach is powerful and cost-efficient but requires engineering effort. If our team is comfortable with serverless code, it could be ideal. We maintain ultimate control (our data sits in R2 under our account, we’re not dependent on a third-party email company). It aligns with the idea of using Cloudflare for storage – we could indeed store all emails in R2 as desired. Given 6esk is a core platform, investing in this kind of foundational capability might be worthwhile for long-term independence.

We might consider a hybrid: use ImprovMX (quick to set up) in the very short term, then migrate to Cloudflare Workers solution as we solidify the product. But for this design, let’s keep Cloudflare as a serious candidate for the recommended solution.

Option 5: Self-Hosted Email Server (Postfix/Dovecot or Mail-in-a-Box, etc.)

The final option is the traditional route: running our own mail server. This could be done on a VPS or cloud instance using open-source mail server software. For example, we could set up Postfix (SMTP server) to receive mails for 6ex.co.za and Dovecot (IMAP server) to store and serve mailboxes. Or use a pre-packaged solution like Mail-in-a-Box or Mailu (Docker images that set up a full mail system with spam filtering, webmail, etc.).

If we self-host, we would control everything: mail comes to our own server (via an MX pointing to our box), and we’d store messages on our disk or database. We could then expose IMAP to our application or, more directly, have the MTA forward incoming mail to a local script that inserts it into the 6esk database.

Pros: Complete ownership of data and infrastructure. No third-party costs beyond a basic server ($5–10/month could run a small mail server). All emails live on our server. We can create as many accounts/aliases as needed. We’re not constrained by any provider’s rules or pricing. This also uses standard protocols – in theory, 6esk’s email front-end could even use IMAP/SMTP directly to interact with the server (though that complicates the app – better to funnel through our backend).

Cons: This is by far the most complex path. Running a mail server is notoriously difficult in terms of maintenance and security:

Deliverability issues: Sending from our own server’s IP is risky because new IPs have no reputation and can be flagged as spam. We’d have to manage feedback loops, monitor blacklists, etc. (This is a big reason to use services like Resend which have trusted IP pools.)

Security and Spam: We’d need to configure spam filtering (SpamAssassin or Rspamd), virus scanning, and apply updates to the mail server software. Misconfigurations can open relays for spammers or data leaks. It’s a heavy operational burden for a small team.

Scaling: If usage grows, a single small server might not suffice. Clustering mail servers or ensuring high availability (so as not to lose emails) gets complicated.

Integration effort: We would have to write code to move emails from the mail server into the CRM (either by IMAP retrieval or by using something like a postfix pipe to send mails to a script). This is extra moving parts and potential points of failure.

Given that our goal is a developer-friendly approach, building a full mail server from scratch is counter to that. It’s doable with enough expertise, but likely not worth the time since excellent services exist to do this for us.

When would self-hosting make sense? Perhaps if data jurisdiction or extreme control was a concern (e.g. we cannot trust any third-party). Or if down the line, cost at massive scale becomes an issue (though at that point, a custom solution on cloud infrastructure might be tailored). For our use case – providing a great email feature in a CRM – it’s better to leverage existing platforms so we can focus on the product, not low-level email server admin.

We will not recommend self-hosting as the primary approach due to its maintenance overhead. But it’s important to acknowledge it as an option and why we’re avoiding it.

Comparing the Options

To recap the inbound (and storage) options, here’s a comparison of their attributes:

Inbound Solution	Cost	Key Pros	Key Cons
Resend Inbound + Webhook	Included in Resend plans (free tier available)	- Unified send+receive vendor (simple setup)
- Developer-friendly API, catch-all by default
- Queues and stores messages if webhook down (no loss)	- Tied to Resend (vendor lock-in for both email directions)
- Usage fees for inbound may apply at scale (unclear pricing)
Mailgun Routes to Webhook	Pay-as-you-go (after free 3 months)	- Reliable, enterprise-grade service
- Advanced parsing to JSON (extracts useful data)
- Built-in spam filtering and temporary storage options	- Separate provider just for inbound (more complexity)
- Cost can increase (volume-based)
- Slightly heavier setup (routes, API keys)
ImprovMX (Forward to Webhook)	Free (1 domain, ~500 emails/day)
Premium $9/mo for higher limits	- Easiest setup; generous free tier
- Supports catch-all & wildcard addresses
- Can forward to multiple targets or webhooks	- Does not store mail (must handle in real-time)
- Fewer deliverability tools (just forwards data)
- Reliant on our endpoint being up (or else potential mail loss)
ForwardEmail (Open-Source)	Free basic forwarding
$3/mo for 10GB mailbox	- Open-source (can self-host if needed)
- Optional hosted mailbox/IMAP access on paid plans
- Privacy-focused (zero data selling)	- Setup and docs are more technical
- Support/community is smaller (DIY approach)
- Self-hosting requires running full mail server anyway
Cloudflare Workers + R2	Mostly free (small Workers & storage usage)
pay as you grow (very low cost)	- Full control of processing & data (no third-party storing emails)
- Scalable serverless architecture (no servers to manage)
- Leverages Cloudflare’s global network (fast and reliable)	- Requires custom development (Worker code, storage schema)
- Cloudflare Email Service still new (some features in beta)
- No built-in spam filtering – must implement if needed
Self-Hosted Mail Server	Server ~$5-10/mo + admin time	- Complete ownership on our hardware
- Standard protocols (could integrate via IMAP/SMTP if desired)
- No external dependencies or vendor limits	- High complexity to maintain (spam, security, updates)
- Hard to achieve good deliverability alone
- Not “developer-friendly” – significant DevOps burden

Looking at this table, the ImprovMX/ForwardEmail route stands out for low cost and simplicity, and the Resend Inbound route stands out for integration and ease (especially since we are already using Resend for outbound). Cloudflare Workers is compelling for control and long-term cost, but it’s a bit more involved initially.

Storing and Managing Emails in 6esk

Regardless of which inbound method we choose, once 6esk receives the email data (via webhook or Worker), we need to store it reliably. The storage design should accommodate potentially thousands of messages, attachments, and allow quick retrieval in the CRM UI.

Storage Options:

Database: We could store emails in our application database (e.g. Postgres) as records – perhaps with fields for subject, sender, timestamp, etc., and the body text. Attachments could be stored as binary blobs in the DB or on a file storage. Storing large raw emails in a SQL DB is not very efficient, though; better to store references.

Cloud Object Storage (Cloudflare R2 or AWS S3): This is ideal for storing email content and attachments. For example, when an email arrives, we generate a unique ID (or use the Message-ID) and save the raw MIME message to an R2 bucket. R2 storage is highly durable (like S3) and has no egress cost when accessed via Cloudflare, which is great for a web app. We can then store just a pointer or key in our database.

Hybrid approach: Use the DB for metadata (sender, subject, read/unread status, thread ID, etc.) and use object storage for the heavy content (email body and attachments). This way our primary DB stays lean and fast for queries, and the bulk data sits in cheaper storage.

Using Cloudflare R2: Since the user specifically mentioned Cloudflare, we strongly consider using R2 for email storage. As demonstrated in the ElasticInbox Cloudflare example, combining KV + R2 yielded a scalable email store. In our context, if we use Cloudflare Workers for inbound, we’d directly write to R2 from the Worker (very fast). If we use any other inbound method (Resend/Mailgun/ImprovMX), the email will come to our webhook as an HTTP request – from within that request handler (running on our server or cloud function), we can use the R2 API (S3 API) to upload the email content.

Cloudflare R2’s advantage is that if our 6esk is also hosted in some Cloudflare Workers/Durable Objects, the integration is seamless. But even if 6esk is a normal server app, R2 can be accessed with keys like any S3.

Attachments: We should extract attachments from the email payload and store them separately (so we don’t have to load the whole email blob every time). For instance, Resend’s webhook will list attachments with IDs and a URL to fetch them from Resend temporarily. We can download each and put it into R2 (or directly forward the binary to R2). For ImprovMX, the webhook will include attachments as base64 or links as well. Our storage design should maybe have an Email record and a separate Attachment record (with filename, content-type, size, and a pointer to the R2 object where it’s stored).

Reliability: By storing in our own storage, we ensure emails are not lost after a provider’s retention window. For example, Resend and Mailgun only keep inbound data for a few days. We will immediately persist everything on arrival. Regular backups of our storage or database would be wise (R2 itself is replicated and durable, but backup never hurts).

Access in CRM: When a user opens the CRM email inbox, our backend will query the DB for that user’s emails. We might implement simple folders or labels (Inbox, Sent, etc.) as metadata. The email body could be loaded from R2 on demand (or cached). Because R2 has high throughput, it can serve as our “mailbox store”. We could also cache text content in the DB for search/indexing – e.g. store the plaintext body for full-text search functionality in the CRM (if we plan to allow searching emails). Attachments can be downloaded from R2 when the user clicks them, via a secure URL or streaming through our backend.

Cloudflare KV/DO vs. our DB: If we went full Cloudflare, we might consider using Workers KV or Durable Objects to store email metadata instead of our own DB. The Medium article author used KV for metadata. However, since 6esk likely already has a database for other CRM data, it’s simplest to reuse that for email records (to link emails with contacts, etc.). We can integrate Cloudflare storage with our existing DB logic.

In conclusion, Cloudflare R2 is recommended for storing the raw email content and attachments, with our primary database storing indices and metadata. This gives us a cost-effective, scalable way to retain all communications. It’s also provider-neutral: even if we change inbound email providers, our stored emails remain in our Cloudflare account. And Cloudflare’s costs are far less than using, say, a traditional email hosting (for example, 10GB on ForwardEmail costs $3/mo, whereas 10GB on R2 would cost around $0.15/mo).

Provisioning New Addresses & Lifecycle

With a catch-all setup, adding a new staff email is trivial: you don’t actually need to create anything on the email server side (unless using a service that requires alias setup). Let’s consider our top choices:

If using Resend Inbound or Cloudflare Workers: Any address will be accepted. So when we onboard a new user “Jane Doe”, we can decide her email is jane.doe@6ex.co.za. We don’t need to inform Resend or Cloudflare about this address – the first time an email comes for it, it will just flow in (because both Resend and Cloudflare treat unknown addresses as catch-all by default). We might internally keep a list of “valid staff emails” in our database, so that if an email comes to an address that isn’t assigned, we know to ignore or flag it. But operationally, no manual steps are needed per address.

If using ImprovMX/ForwardEmail: We can leverage catch-all here too. ImprovMX allows a catch-all alias (e.g. forwarding *@6ex.co.za to our webhook). If we set that up, again any new address works automatically. Alternatively, we could create aliases one-by-one in their dashboard, but that’s extra work and not necessary with catch-all. We’d likely choose the wildcard approach for automation.

Mailgun: We’d configure a route with a pattern (regex or wildcard) to catch all addresses. So similarly, any address is accepted. (If we only wanted certain addresses, we could specify, but in our case we want flexibility.)

Self-hosted server: We’d have to either configure a catch-all mailbox or alias in Postfix (possible, but careful as it catches spam to random addresses). Or provision accounts per user which is laborious. Another reason self-host is less appealing unless heavily automated.

So clearly, the solutions we like all support catch-all routing, enabling automatic provisioning of addresses. The CRM’s job is simply to present a new user with their email address and ensure any incoming mail to that address is routed to that user’s inbox in the app.

Not Destroying Addresses: When a staff member leaves, best practice (and as the user noted) is not to delete or completely disable their email address. We can handle this by either forwarding their emails to an archive or another user, or keeping their inbox active in a suspended state. Since we’re catch-all, even if we remove the user from 6esk, emails to their address will still come through. We should decide how to handle them:

E.g. mark them and send an auto-reply “this person has left, contact support” or simply continue to capture them in an “former staff” mailbox.

For domain reputation, it’s better to avoid hard bouncing (“user not found”) responses. Hard bounces could affect how other mail servers view our domain (many bounces might indicate poor maintenance). With catch-all, we won’t bounce – we’ll accept everything. So that actually inherently preserves our “IP/domain reputation” in that sense.

We just need an internal policy for those emails (maybe route to a general admin inbox or keep them in a hidden archive).

This approach of never bouncing does carry a risk: spammers often target random addresses (like abc@domain.com). A catch-all will accept those, so we might end up processing more spam. But handling spam is a separate challenge; at least our domain will be seen as receptive and not generate bounce backscatter. We can implement spam filtering logic to drop obvious junk after acceptance, to avoid filling our storage unnecessarily (Mailgun’s mention of parsing and filtering is relevant here).

Deliverability & DNS Configuration

To ensure our emails reliably arrive in inboxes (outbound) and that other servers accept our inbound setup, we must configure a few DNS records and settings:

SPF (Sender Policy Framework): We’ll add a TXT record for 6ex.co.za like: v=spf1 include:resend.mail <etc> -all. Resend will provide the exact include domain to authorize their mail servers to send as 6ex.co.za. If we use multiple sending sources (say Resend and ImprovMX’s SMTP), we’d include both. SPF helps mail receivers verify that an IP is allowed to send our domain’s emails.

DKIM (DomainKeys Identified Mail): Resend will give us a DKIM public key (published as a DNS record under a selector like resend._domainkey.6ex.co.za). Outbound emails will be signed with the corresponding private key. Receivers use this to confirm the message wasn’t tampered with and truly comes from our domain. We should set a DMARC record as well (to tell receivers how to handle authentication failures and to get reports).

MX Records: For inbound, set MX pointing to whichever service we choose:

Resend: likely something like <hash>.inbound.resend.exchange (just as an example; we’d find it in their docs).

ImprovMX: mx1.improvmx.com and mx2.improvmx.com (with appropriate priority).

Mailgun: mxa.mailgun.org etc., if using their subdomain.

Cloudflare: they provide unique MX targets when Email Routing is enabled (like **.mx.cloudflare.net).

Only one set of MX records can be active for the root domain, so we commit to one inbound service at a time (or use subdomains for multiple).

Custom Domain vs Subdomain for Inbound: If, for example, we already had some email service on the root domain, we could do inbound on a subdomain (Resend documentation suggests that if you have existing MX, use a subdomain for new service). In our case, we likely won’t have a legacy email service, so we can use 6ex.co.za directly. If we did want to keep say Google Workspace for a few addresses, we could instead do something like staff.6ex.co.za for the CRM email addresses with separate MX. But it seems unnecessary here.

BIMI: If we pursue BIMI, after DMARC is enforced (policy quarantine or reject), we publish a BIMI DNS record: a TXT record at default._bimi.6ex.co.za pointing to an SVG logo URL. Some receivers (like Gmail, Yahoo) will then show our brand logo in the avatar slot. BIMI is optional and requires a verified trademark logo in some cases, so it may be a later consideration. It doesn’t affect deliverability directly, but it’s a polish item.

Inbound Deliverability: Usually, inbound email doesn’t require special records – senders will deliver based on MX. We should ensure reverse DNS and such are handled by our providers (e.g. if using Resend or ImprovMX, they handle their inbound server reputation). One thing: if we run our own server or even Cloudflare Workers, we might want an SPF record for others sending to us doesn’t directly apply. Instead, some senders use MX validation (they check if your MX host corresponds to your domain). As long as we have valid MX records and a working postmaster@ address (some receivers check that), we’ll be fine. We should set up postmaster@6ex.co.za and abuse@6ex.co.za as aliases to an internal address per RFC requirements (likely route those to our support team or to the admin’s email). This is a small detail to show we run a proper mail domain.

Spam Handling: For outbound, using Resend, we trust their IP reputation and feedback loops. For inbound, as discussed, we may incorporate spam filtering. If using Mailgun, they have a filter we can turn on. If using Resend inbound or ImprovMX, we would get everything and might implement a spam classifier. Initially, we could simply mark all incoming mail to unknown aliases or obvious spam content and perhaps separate them. As the system matures, integrate a spam scoring service or use Cloudflare’s AI (they even suggested using Workers AI to label emails).

Recommended Solution & Architecture Plan

After weighing the options, a hybrid approach leveraging Resend for outbound and Cloudflare/ImprovMX for inbound emerges as the best balance of cost, simplicity, and control. Here’s our recommended end-to-end solution:

1. Outbound with Resend: Continue with Resend’s API for sending emails. Set up the domain authentication (SPF, DKIM provided by Resend). Test sending emails from *@6ex.co.za to ensure they land in inbox (not spam). Take advantage of Resend’s webhooks to log delivered, bounced events in our CRM for each message (this will help us show email status to users and debug if a client didn’t receive an email). Resend ensures high deliverability and scales as our volume grows, without the need for our own SMTP server.

2. Inbound via Cloudflare Email Routing (Worker): Configure Cloudflare Email Routing on 6ex.co.za with a catch-all rule to deliver to a Worker script. Develop a Cloudflare Worker that runs on incoming emails:

The Worker will parse the incoming message. We can initially just take the raw content and parse basic fields (From, To, Subject, Date, plain text body, HTML body).

The Worker then makes an API call to 6esk’s backend (e.g. a secure endpoint) with the email data. Alternatively, to minimize external calls, the Worker itself could directly put the email into Cloudflare R2 storage and update a Durable Object that 6esk can query. However, keeping 6esk’s database as the central index might be simpler: so the Worker calls our API.

Our backend receives the email data and stores it in the DB (as a new Email record linked to the recipient user). Simultaneously, the Worker can upload attachments to R2 and include the R2 URLs (or IDs) in the payload.

Result: The email shows up in the user’s CRM inbox almost instantly after it was sent.

This approach uses Cloudflare for the heavy lifting (receiving and initial processing) but still lets our main app manage the data. The zero-cost nature of Cloudflare’s service is a big win (we avoid per-email fees for inbound). Cloudflare also automatically encrypts and secures the email handoff to the Worker, and we benefit from their reliability.

If developing a Cloudflare Worker from scratch is a concern, an alternative short-term plan would be:

Use ImprovMX for inbound initially: Point MX to ImprovMX, set a webhook to 6esk. This can be set up in minutes and tested. It’s free and will handle catch-all forwarding. Our webhook processing code in 6esk would be similar (receive JSON, store email).

Once stable, we could migrate to Cloudflare Workers for more control (this would just mean changing MX records and slightly adjusting the webhook format handling).

However, if we have the development bandwidth, starting with Cloudflare might save a migration later. We could also run both in parallel on different subdomains for testing.

3. Email Storage with Cloudflare R2: Set up a Cloudflare R2 bucket (e.g. 6esk-emails). Whenever our backend receives an inbound email (from the Worker or ImprovMX), it will:

Generate a unique filename or key (e.g. <message-id>.eml or an internal UUID).

Store the raw MIME content into R2 (using R2’s S3 API via an AWS SDK or HTTP).

For attachments, store each as a separate object, and replace the content in the email record with a link or marker.

Save an entry in the database with metadata (sender, subject, etc.), link to the storage object keys, and mark it as “unread”.

For outbound emails, we should also store those in the CRM for a complete conversation view. We can intercept the email content before sending (since the user composes it in 6esk) and store a copy in R2/DB as well, marked as “sent” folder. This way, the user sees both sent and received emails in one place.

Cloudflare R2 will hold all data long-term. We’ll implement retention policies if needed (maybe never delete, or perhaps allow the user to delete if required, since storage is cheap). We should also consider encryption of stored emails (R2 by default encrypts at rest on their side; if extra sensitive, we could encrypt contents before storing, but that adds complexity for search/indexing).

4. DNS and Domain Setup: Publish SPF including Resend and any others (if using Cloudflare Email, they might give an include as well if they send any system emails – but if Workers are just receiving and we send via Resend, then SPF just needs Resend). Enable DKIM for Resend. Add DMARC record (v=DMARC1; p=none; rua=mailto:postmaster@6ex.co.za;) initially to collect reports, later maybe p=quarantine. Set MX records to Cloudflare (or ImprovMX during phase1). Also add the necessary verification records for ImprovMX or Resend (ImprovMX might ask to verify domain ownership via TXT as well). Finally, ensure we have the postmaster@ alias (ImprovMX auto-forwards those to your account email by default).

5. Integrate with CRM UI: Build the email UI in 6esk to display messages. This likely means an “Inbox” section per user. We can model threads by grouping messages with the same subject or in-reply-to headers (optional feature). The UI should allow replying which pre-fills the recipient (the original sender) and perhaps shows previous context. When user hits send, we call Resend API and also log the reply in our DB. For receiving, we might implement a push notification or polling: since we get the webhook in backend, we can notify the front-end in real-time (e.g. via WebSocket or just refresh the inbox list periodically) so that new emails appear without page reload.

6. Testing & Deliverability Tuning: We will extensively test with various email providers:

Send test emails from Gmail, Outlook, Yahoo to a 6esk address and verify they appear.

Reply from 6esk via Resend and check those land in Gmail/Outlook, etc. Check if they go to spam; if so, adjust content or DNS until they do not. Likely with proper SPF/DKIM they will inbox.

Test edge cases: attachments (PDFs, images), large emails (~15MB) to see if our pipeline handles them (Resend supports up to 40MB attachments which is higher than Mailgun’s 25MB).

Test what happens if our webhook is down: e.g. if using ImprovMX, does it retry or drop? (ImprovMX docs suggest webhooks will retry a few times; we should confirm and maybe set up a secondary forward).

Monitor any deliverability issues. We can use DMARC aggregate reports to see if anyone is spoofing our domain or if our emails fail checks anywhere.

7. Scale and Future-Proofing: This setup should scale well:

Outbound via Resend can send millions of emails if needed (we’d just move to a higher plan or dedicated IP as volume grows).

Inbound via Cloudflare Workers can handle huge concurrency – Cloudflare will scale up as emails come in (and if volume is extremely high, we might incur some cost on extra requests or storage, but it will be incremental and minor per email).

The storage (R2) can scale to terabytes of data cheaply. We’d just pay for what we use (~$0.015 per GB). Access is also cheap, especially if data is served to our users via Cloudflare (no egress fees).

One consideration: if we onboard many clients on 6esk each with their domain’s email, the design can extend by setting up each domain either with our Cloudflare setup or a separate route. But since this question focuses on one domain, we keep it scoped. The architecture is multi-tenant capable though (e.g. Resend allows multiple domains, or Cloudflare can handle multiple domains with Workers).

Long-term, if Cloudflare Email Service (currently in beta) becomes widely available, we could even shift all email sending to Cloudflare, reducing reliance on Resend. Cloudflare aims to auto-manage DKIM/SPF and claims great deliverability. But until proven, Resend is our outbound choice.

8. Open-Source Tools: If we wanted to incorporate open-source, one interesting future idea is using the JMAP protocol (a modern JSON-based email protocol) within 6esk. The ElasticInbox Cloudflare PoC mentioned possibly implementing JMAP for a full feature set. JMAP could let us sync emails to clients if we ever open an API. However, this is beyond the immediate needs. For now, simple REST endpoints in our CRM for fetching emails are fine.

Another tool: we might use an open-source MIME parsing library on our backend to handle any tricky parts of email format. But since Resend/Mailgun provide JSON, that’s largely handled. For Cloudflare Worker, there’s an open-source Cloudflare email toolkit that could help with parsing and sending.

Finally, ensure we document and automate all these setups (Infrastructure as code for DNS, Worker scripts in repo, etc.), so deploying this system is reproducible.

Conclusion

Recommendation: Implement 6esk’s email feature using Resend for sending and Cloudflare Email Routing with a Worker for receiving, storing emails in Cloudflare R2 and our database. This combination meets all goals: it’s low-cost (largely free inbound, pay-per-use outbound), developer-friendly (webhooks and APIs instead of running mail servers), and gives us control over our data. We avoid expensive suites by building on flexible services.

This solution offers solid deliverability for outbound (leveraging Resend’s infrastructure) and a highly scalable inbound pipeline (Cloudflare’s global network). We retain full ownership of stored emails, and we can provision addresses on the fly with no friction. The trade-offs are the added responsibility to implement the Cloudflare Worker and maintaining our storage. However, the resources and examples available (as cited) demonstrate that a serverless email storage system is achievable.

Overall, this architecture will provide 6esk with a first-class email module – one that feels seamless to the user (like a native email client), yet is cost-efficient and within our control to modify as our platform grows. By carefully setting up deliverability measures (SPF, DKIM, DMARC, BIMI) and choosing modern email infrastructure, 6esk’s emails should reliably reach customers’ inboxes and allow staff to manage conversations without ever leaving the CRM. This email capability will be a foundational pillar of the 6esk CRM, enabling better user communication and product value without incurring the overhead of legacy email systems.