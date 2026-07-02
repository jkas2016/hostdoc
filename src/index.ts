#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, type OptionValues } from "commander";
import { runSetup } from "./commands/setup.js";
import { runInit } from "./commands/init.js";
import { runProvision } from "./commands/provision.js";
import { runDeprovision } from "./commands/deprovision.js";
import { infraDir } from "./lib/config.js";
import { runPublish } from "./commands/publish.js";
import { listDocs, formatRows } from "./commands/list.js";
import { runRm } from "./commands/rm.js";
import { runOpen, openPublishedUrl } from "./commands/open.js";
import { describeConfig } from "./commands/config.js";

// package.json lives outside rootDir (src), so read it at runtime instead of
// importing it. From dist/index.js or src/index.ts, `../package.json` is the
// package root's manifest in both the built and dev (tsx) entry points.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("hostdoc")
  .description("Publish a local HTML file or folder to your own AWS and get a short link.")
  .version(version, "-v, --version", "output the version number");

function fail(err: unknown): never {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}

/** Credential + config-override options shared by commands that resolve config. */
function withCommon(cmd: Command): Command {
  return cmd
    .option("--profile <name>", "AWS profile")
    .option("--region <region>", "AWS region")
    .option("--bucket <name>", "override bucket")
    .option("--domain <domain>", "override domain (cloudfront mode)")
    .option("--distribution <id>", "override distribution id (cloudfront mode)");
}

function overrides(o: OptionValues) {
  return {
    profile: o.profile as string | undefined,
    region: o.region as string | undefined,
    bucket: o.bucket as string | undefined,
    domain: o.domain as string | undefined,
    distribution: o.distribution as string | undefined,
  };
}

program
  .command("setup")
  .description("Create a public S3 static-website bucket and save config")
  .requiredOption("--bucket <name>", "bucket name to create")
  .requiredOption("--region <region>", "AWS region for the bucket")
  .option("--profile <name>", "AWS profile")
  .action(async (opts) => {
    try {
      const cfg = await runSetup({
        bucket: opts.bucket,
        region: opts.region,
        profile: opts.profile,
      });
      console.log(`Created s3-website bucket "${cfg.bucket}".`);
      console.log(`Public base: ${cfg.websiteEndpoint}/`);
      console.log("Note: this bucket serves content publicly over HTTP.");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("init")
  .description("Import domain (Terraform) infra outputs and write a cloudfront config")
  .requiredOption("--from-terraform <dir>", "path to the Terraform infra directory")
  .action((opts) => {
    try {
      const cfg = runInit({ dir: opts.fromTerraform });
      console.log(
        `Wrote cloudfront config for ${cfg.domain} (distribution ${cfg.distributionId}).`,
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command("provision")
  .description("Provision domain infra via Terraform (init + apply) and write a cloudfront config")
  .option("--dir <dir>", "Terraform infra directory (default: per-user state dir)", infraDir())
  .option("--hosted-zone <zone>", "existing Route53 hosted zone (domain mode)")
  .option("--subdomain <sub>", "subdomain; the site is <subdomain>.<hosted-zone>")
  .option("--region <region>", "AWS region for the S3 bucket (cert is always us-east-1)")
  .option("--price-class <class>", "CloudFront price class (default PriceClass_100)")
  .option("--approve", "auto-approve terraform apply (non-interactive; for agents/automation)")
  .action((opts) => {
    try {
      const cfg = runProvision({
        dir: opts.dir,
        approve: opts.approve,
        flags: {
          hostedZone: opts.hostedZone,
          subdomain: opts.subdomain,
          region: opts.region,
          priceClass: opts.priceClass,
        },
      });
      console.log(
        `Provisioned ${cfg.domain}; cloudfront config written (distribution ${cfg.distributionId}).`,
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command("deprovision")
  .description("Tear down the domain infra via Terraform (destroy)")
  .option("--dir <dir>", "Terraform infra directory (default: per-user state dir)", infraDir())
  .option("--hosted-zone <zone>", "existing Route53 hosted zone (domain mode)")
  .option("--subdomain <sub>", "subdomain; the site is <subdomain>.<hosted-zone>")
  .option("--region <region>", "AWS region for the S3 bucket (cert is always us-east-1)")
  .option("--price-class <class>", "CloudFront price class (default PriceClass_100)")
  .option("--approve", "auto-approve terraform destroy (non-interactive; for agents/automation)")
  .action((opts) => {
    try {
      runDeprovision({
        dir: opts.dir,
        approve: opts.approve,
        flags: {
          hostedZone: opts.hostedZone,
          subdomain: opts.subdomain,
          region: opts.region,
          priceClass: opts.priceClass,
        },
      });
      console.log(
        "Domain infrastructure destroyed. Run `hostdoc provision` to recreate it.",
      );
    } catch (err) {
      fail(err);
    }
  });

withCommon(program.command("publish <path>"))
  .description("Publish a file or folder; prints the public URL")
  .option("--slug <path>", "custom path instead of a random code; '/' allowed for nested paths (e.g. team/q1/report)")
  .option("--title <title>", "override the document title")
  .option("--force", "overwrite an existing slug")
  .option("--open", "open the URL in your browser")
  .option("--dry-run", "show the URL without uploading")
  .action(async (path, opts) => {
    try {
      const url = await runPublish({
        path,
        slug: opts.slug,
        title: opts.title,
        force: opts.force,
        dryRun: opts.dryRun,
        ...overrides(opts),
      });
      console.log(url);
      if (opts.open && !opts.dryRun) openPublishedUrl(url, overrides(opts));
    } catch (err) {
      fail(err);
    }
  });

withCommon(program.command("list"))
  .description("List published documents")
  .action(async (opts) => {
    try {
      const rows = await listDocs(overrides(opts));
      console.log(formatRows(rows));
    } catch (err) {
      fail(err);
    }
  });

withCommon(program.command("rm <id>"))
  .description("Delete a document by code or slug")
  .option("--yes", "skip confirmation")
  .action(async (id, opts) => {
    try {
      await runRm({ id, yes: opts.yes, ...overrides(opts) });
      console.log(`Deleted ${id}.`);
    } catch (err) {
      fail(err);
    }
  });

withCommon(program.command("open <id>"))
  .description("Open a document's URL in your browser (does not verify the document exists)")
  .action((id, opts) => {
    try {
      console.log(runOpen({ id, ...overrides(opts) }));
    } catch (err) {
      fail(err);
    }
  });

withCommon(program.command("config"))
  .description("Show the active configuration")
  .action((opts) => {
    try {
      console.log(describeConfig(overrides(opts)));
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync();
