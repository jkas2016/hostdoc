// hostdoc docs — the guide page. Composed entirely from design-system
// components + shared prose primitives, so future pages reuse the same parts.
import { Terminal, CodeBlock, Note, CopyLink, Tabs, Badge, Button, Card } from '../ds/components/index.js';
import { Section, P, C } from '../ds/prose.jsx';

export const GUIDE_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'install', label: 'Prerequisites & install' },
  { id: 'credentials', label: 'AWS credentials' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'domain', label: 'Domain mode' },
  { id: 'config', label: 'Configuration' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'agent', label: 'Use with an agent' },
];

// ---- Hero ----
function Hero() {
  return (
    <section style={{ paddingTop: 40 }}>
      <Badge tone="brand" dot>Phase 1 · S3 website + CloudFront</Badge>
      <h1 style={{ fontSize: 'clamp(40px, 6vw, 60px)', lineHeight: 1.04, letterSpacing: '-0.025em', margin: '20px 0 18px', maxWidth: 720 }}>
        Publish a doc.<br/>Get a short link.
      </h1>
      <P>
        <strong>hostdoc</strong> uploads a local HTML file or folder to <strong>your own AWS</strong> and
        returns a short, shareable link — no platform account, no data leaving your cloud.
      </P>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0 28px' }}>
        <Button as="a" href="#quickstart" variant="primary" size="lg">Quick start</Button>
        <Button as="a" href="https://github.com/jkas2016/hostdoc" variant="secondary" size="lg">View on GitHub</Button>
      </div>
      <Terminal title="bash — publish" lines={[
        { type: 'cmd', text: 'npm install -g hostdoc' },
        { type: 'cmd', text: 'hostdoc setup --bucket my-bucket --region us-east-1' },
        { type: 'cmd', text: 'hostdoc publish ./report.html --slug aws-design' },
        { type: 'comment', text: '# uploading 1 file…' },
        { type: 'success', text: 'http://my-bucket.s3-website-us-east-1.amazonaws.com/aws-design/' },
      ]} />
      <div style={{ marginTop: 16 }}>
        <CopyLink url="http://my-bucket.s3-website-us-east-1.amazonaws.com/aws-design/" />
      </div>
    </section>
  );
}

// ---- Mode comparison ----
function ModeCard({ badge, tone, title, link, rows, cta }) {
  return (
    <Card variant="outline" padding="none" style={{ flex: 1, minWidth: 260, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line)' }}>
        <Badge tone={tone} dot>{badge}</Badge>
        <h3 style={{ fontSize: 18, margin: '12px 0 4px' }}>{title}</h3>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-500)' }}>{link}</div>
      </div>
      <div style={{ padding: '6px 20px 4px', flex: 1 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14 }}>
            <span style={{ color: 'var(--ink-500)' }}>{r[0]}</span>
            <span style={{ color: 'var(--ink-800)', fontWeight: 500, textAlign: 'right' }}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '14px 20px 18px' }}>{cta}</div>
    </Card>
  );
}

function OverviewSection() {
  return (
    <Section id="overview" kicker="Overview" title="Two hosting modes, one upload path">
      <P>hostdoc has two hosting modes that share one upload path. You pick a mode by how you configure it — the mode is derived, never stored.</P>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
        <ModeCard
          badge="HTTP" tone="neutral" title="No domain"
          link="s3-website endpoint"
          rows={[['Link', 'HTTP'], ['Bucket', 'Public S3 website bucket'], ['Set up with', 'hostdoc setup (CLI)'], ['Custom domain', 'No'], ['Use when', 'Quick internal sharing, no HTTPS needed']]}
          cta={<Button as="a" href="#quickstart" variant="secondary" size="sm" fullWidth>Quick start →</Button>}
        />
        <ModeCard
          badge="HTTPS" tone="brand" title="Domain"
          link="cloudfront + custom domain"
          rows={[['Link', 'HTTPS'], ['Bucket', 'Private S3, served via CloudFront (OAC)'], ['Set up with', 'hostdoc provision (Terraform)'], ['Custom domain', 'Yes (Route53 hosted zone)'], ['Use when', 'Public-facing links that must be HTTPS']]}
          cta={<Button as="a" href="#domain" variant="primary" size="sm" fullWidth>Domain mode →</Button>}
        />
      </div>
    </Section>
  );
}

function InstallSection() {
  return (
    <Section id="install" kicker="Setup" title="Prerequisites & install">
      <ul style={{ margin: '0 0 20px', paddingLeft: 20, color: 'var(--ink-700)', fontSize: 16, lineHeight: 1.9, maxWidth: 680 }}>
        <li><strong>Node.js ≥ 22.12</strong> — check with <C>node --version</C>.</li>
        <li><strong>An AWS account</strong> with credentials available to the AWS SDK (see <a href="#credentials">AWS credentials</a>).</li>
        <li>For domain mode only: <strong>Terraform</strong> installed and a <strong>Route53 hosted zone</strong>.</li>
      </ul>
      <CodeBlock theme="dark" lang="bash" code="npm install -g hostdoc" />
    </Section>
  );
}

function CredentialsSection() {
  const tabs = [
    { id: 'env', label: 'Env vars' },
    { id: 'profile', label: 'Shared profile' },
    { id: 'sso', label: 'SSO' },
  ];
  const code = {
    env: 'export AWS_ACCESS_KEY_ID=AKIA...\nexport AWS_SECRET_ACCESS_KEY=...\nexport AWS_REGION=us-east-1',
    profile: 'aws configure --profile hostdoc      # writes ~/.aws/credentials\nhostdoc publish ./report.html --profile hostdoc',
    sso: 'aws sso login --profile my-sso\nhostdoc publish ./report.html --profile my-sso',
  };
  return (
    <Section id="credentials" kicker="Auth" title="AWS credentials">
      <P>hostdoc <strong>never stores AWS keys</strong>. It uses the AWS SDK default credential chain (environment variables → SSO → shared <C>~/.aws</C> profile). Pick a profile with <C>--profile &lt;name&gt;</C> and a region with <C>--region &lt;region&gt;</C>. Use any one of the three setups below.</P>
      <Tabs variant="segmented" tabs={tabs} style={{ marginBottom: 14 }}>
        {(a) => <div style={{ marginTop: 14 }}><CodeBlock theme="dark" lang="bash" code={code[a]} /></div>}
      </Tabs>
      <Note tone="info" title="Use a dedicated IAM user">
        Prefer a <strong>dedicated IAM user</strong> with a minimal policy over root credentials. See the AWS docs for <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html">creating an IAM user</a> and <a href="https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_create.html">attaching a policy</a>. For domain mode, Terraform emits a ready-made minimal <C>publisher_policy_json</C> output (and can create the user with <C>create_publisher_user = true</C>).
      </Note>
    </Section>
  );
}

function QuickstartSection() {
  return (
    <Section id="quickstart" kicker="No domain" title="Quick start (S3 website)">
      <P>This mode serves content <strong>publicly over HTTP</strong> from an S3 static-website bucket (S3 website endpoints do not support HTTPS). For HTTPS, see <a href="#domain">Domain mode</a>.</P>
      <Terminal title="bash" lines={[
        { type: 'comment', text: '# 1) create a public website bucket and save config' },
        { type: 'cmd', text: 'hostdoc setup --bucket my-unique-bucket --region us-east-1' },
        { type: 'comment', text: '# 2) publish a file or a folder' },
        { type: 'cmd', text: 'hostdoc publish ./report.html' },
        { type: 'cmd', text: 'hostdoc publish ./site/ --slug aws-design' },
        { type: 'cmd', text: 'hostdoc publish ./site/ --slug team/q1/report' },
        { type: 'comment', text: '# 3) manage' },
        { type: 'cmd', text: 'hostdoc list' },
        { type: 'cmd', text: 'hostdoc open aws-design' },
        { type: 'cmd', text: 'hostdoc rm aws-design --yes' },
      ]} />
      <div style={{ height: 16 }} />
      <Note tone="warning">
        <C>--dry-run</C> prints the URL it <em>would</em> publish to without uploading — and without any AWS call, so it works offline. <C>open</C> builds and opens the URL without checking the document exists. <C>rm</C> asks for confirmation; pass <C>--yes</C> to skip it (required when stdin is not a TTY).
      </Note>
    </Section>
  );
}

function DomainSection() {
  return (
    <Section id="domain" kicker="HTTPS" title="Domain mode (CloudFront)">
      <P>Domain mode serves your docs over HTTPS from a fully private S3 bucket fronted by CloudFront (OAC). It is provisioned with Terraform — <strong>no repo checkout needed</strong>: the templates ship inside the npm package and are extracted for you into <C>$XDG_STATE_HOME/hostdoc/infra</C> (i.e. <C>~/.local/state/hostdoc/infra</C>).</P>
      <P><strong>Prerequisites:</strong> a Route53 hosted zone for your domain, AWS credentials, and Terraform installed.</P>
      <Terminal title="bash" lines={[
        { type: 'cmd', text: 'hostdoc provision \\' },
        { type: 'cmd', text: '  --hosted-zone example.com \\' },
        { type: 'cmd', text: '  --subdomain shared --region us-east-1' },
        { type: 'comment', text: '# extracts bundled Terraform, writes terraform.tfvars.json from the flags,' },
        { type: 'comment', text: '# runs terraform init + apply, and saves config (~15-30 min).' },
        { type: 'comment', text: '# non-interactive (e.g. driving hostdoc from an agent): add --approve' },
        { type: 'cmd', text: 'hostdoc publish ./mydoc' },
      ]} />
      <div style={{ marginTop: 16 }}>
        <CopyLink url="https://shared.example.com/aws-design/" />
      </div>
      <div style={{ height: 20 }} />
      <P>The single local <C>terraform.tfstate</C> lives in that per-user dir, so it is reused no matter where you run hostdoc from, and <C>deprovision</C> always finds it. Override the location with <C>--dir</C>. Re-running <C>provision</C> never clobbers a dir you have already edited. <C>--price-class</C> overrides the default <C>PriceClass_100</C>.</P>
      <P>Already provisioned the infra yourself? Import it without applying: <C>hostdoc init --from-terraform &lt;dir&gt;</C>. Tear it all down with <C>hostdoc deprovision</C> (reuses the saved <C>terraform.tfvars.json</C>; add <C>--approve</C> for non-interactive). Overwriting (<C>--force</C>) and <C>hostdoc rm</C> automatically invalidate <C>/&lt;code&gt;/*</C> on the distribution.</P>
      <h3 style={{ margin: '28px 0 10px' }}>External (non-Route53) DNS</h3>
      <Note tone="info">
        Automated ACM validation and alias records require a Route53 hosted zone. If your domain is hosted elsewhere (e.g. Cloudflare), provisioning is manual: add the ACM validation CNAME shown by AWS, then point your subdomain at the CloudFront distribution domain via a CNAME/ALIAS record.
      </Note>
    </Section>
  );
}

function ConfigSection() {
  const rows = [
    ['1 · highest', 'CLI flags', '--bucket, --region, --profile', 'brand'],
    ['2', 'Environment variables', 'HOSTDOC_BUCKET, HOSTDOC_REGION, HOSTDOC_DISTRIBUTION', 'neutral'],
    ['3 · lowest', 'Config file', '~/.config/hostdoc/config.json', 'neutral'],
  ];
  return (
    <Section id="config" kicker="Reference" title="Configuration & precedence">
      <P>Settings resolve in this order — earlier wins. This lets you point hostdoc at bring-your-own infrastructure.</P>
      <Card variant="outline" padding="none" style={{ overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 16, padding: '14px 20px', borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'baseline' }}>
            <div><Badge tone={r[3]}>{r[0]}</Badge></div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink-800)', marginBottom: 3 }}>{r[1]}</div>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-500)' }}>{r[2]}</code>
            </div>
          </div>
        ))}
      </Card>
      <div style={{ height: 14 }} />
      <P>Inspect the saved config with <C>hostdoc config</C>.</P>
    </Section>
  );
}

function TroubleshootingSection() {
  const rows = [
    ['No configuration found. Run hostdoc setup …', <>Not set up yet — run <C>hostdoc setup</C> (no domain) or <C>hostdoc provision</C> (domain), or pass <C>--bucket/--region</C> (or <C>HOSTDOC_BUCKET/HOSTDOC_REGION</C>).</>],
    ['Invalid config at <path>: not valid JSON / expected a JSON object', <>The config file is corrupted. Fix or delete <C>~/.config/hostdoc/config.json</C> and re-run setup.</>],
    ["Incomplete cloudfront config: 'domain' set without 'distributionId'", <>Domain is set but the distribution id is missing. Set <C>--distribution</C> / <C>HOSTDOC_DISTRIBUTION</C>, run <C>hostdoc init --from-terraform &lt;dir&gt;</C>, or unset the domain for s3-website mode.</>],
    ['Incomplete cloudfront config: bucket and region are required', <>Run <C>hostdoc init --from-terraform &lt;dir&gt;</C> to import the bucket and region.</>],
    ['Could not load credentials from any providers', <>No usable AWS credentials. Configure env vars, a <C>--profile</C>, or SSO (see <a href="#credentials">AWS credentials</a>).</>],
    ['terraform is not installed or not on PATH …', <>Install Terraform (e.g. <C>brew install terraform</C>) and retry.</>],
    ['No terraform.tfvars in "<dir>". Pass --hosted-zone … --subdomain …', <>Run <C>provision</C>/<C>deprovision</C> from the provisioned dir, or pass <C>--hosted-zone</C>, <C>--subdomain</C>, and <C>--region</C> (all three required together).</>],
    ['Could not read terraform outputs from "<dir>" …', <>Ensure Terraform is installed and <C>terraform apply</C> has run in that dir before <C>init --from-terraform</C>.</>],
    ['Slug "<x>" already exists. Use --force to overwrite.', <>Pick a different <C>--slug</C> or pass <C>--force</C> (force also invalidates the CloudFront path in domain mode).</>],
    ['Path not found / Folder is empty / Document not found', <>Check the file/folder path you published, or the id you passed to <C>open</C>/<C>rm</C>.</>],
  ];
  return (
    <Section id="troubleshooting" kicker="Help" title="Troubleshooting">
      <Card variant="outline" padding="none" style={{ overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)', gap: 20, padding: '14px 20px', borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--danger-600)', lineHeight: 1.5, wordBreak: 'break-word' }}>{r[0]}</code>
            <div style={{ fontSize: 14, color: 'var(--ink-700)', lineHeight: 1.5 }}>{r[1]}</div>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function AgentSection() {
  return (
    <Section id="agent" kicker="Automation" title="Use with an agent (skill)">
      <P>hostdoc ships an installable agent skill so coding agents can drive it conversationally — “publish this folder”, “list my docs”, “remove that slug” — without memorizing flags.</P>
      <CodeBlock theme="dark" lang="bash" code="npx skills add jkas2016/hostdoc" />
      <div style={{ height: 14 }} />
      <P muted>The skill shells out to the hostdoc CLI (preferring a global install, falling back to <C>npx -y hostdoc</C>), so no global install is required. It runs an AWS-free preflight and turns missing config/credentials into guidance instead of raw errors.</P>
      <footer style={{ marginTop: 56, paddingTop: 24, borderTop: '1px solid var(--line)', color: 'var(--ink-500)', fontSize: 14, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <span>hostdoc — MIT</span>
        <a href="https://github.com/jkas2016/hostdoc">GitHub</a>
        <a href="https://www.npmjs.com/package/hostdoc">npm</a>
        <a href="https://github.com/jkas2016/hostdoc/issues">Issues</a>
      </footer>
    </Section>
  );
}

export function GuidePage() {
  return (
    <>
      <Hero />
      <OverviewSection />
      <InstallSection />
      <CredentialsSection />
      <QuickstartSection />
      <DomainSection />
      <ConfigSection />
      <TroubleshootingSection />
      <AgentSection />
    </>
  );
}
