#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./commands/setup.js";
import { runPublish } from "./commands/publish.js";
import { listDocs, formatRows } from "./commands/list.js";
import { runRm } from "./commands/rm.js";
import { runOpen } from "./commands/open.js";
import { describeConfig } from "./commands/config.js";

const program = new Command();
program
  .name("hostdoc")
  .description("Publish a local HTML file or folder to your own AWS and get a short link.")
  .option("--profile <name>", "AWS profile")
  .option("--region <region>", "AWS region")
  .option("--bucket <name>", "override bucket")
  .option("--domain <domain>", "override domain (cloudfront mode)")
  .option("--distribution <id>", "override distribution id (cloudfront mode)");

const globals = () => program.opts<{
  profile?: string;
  region?: string;
  bucket?: string;
  domain?: string;
  distribution?: string;
}>();

function fail(err: unknown): never {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}

program
  .command("setup")
  .description("Create a public S3 static-website bucket and save config")
  .requiredOption("--bucket <name>", "bucket name to create")
  .requiredOption("--region <region>", "AWS region for the bucket")
  .action(async (opts) => {
    try {
      const cfg = await runSetup({ bucket: opts.bucket, region: opts.region, profile: globals().profile });
      console.log(`Created s3-website bucket "${cfg.bucket}".`);
      console.log(`Public base: ${cfg.websiteEndpoint}/`);
      console.log("Note: this bucket serves content publicly over HTTP.");
    } catch (err) { fail(err); }
  });

program
  .command("publish <path>")
  .description("Publish a file or folder; prints the public URL")
  .option("--slug <name>", "custom slug instead of a random code")
  .option("--title <title>", "override the document title")
  .option("--force", "overwrite an existing slug")
  .option("--open", "open the URL in your browser")
  .option("--dry-run", "show the URL without uploading")
  .action(async (path, opts) => {
    try {
      const g = globals();
      const url = await runPublish({
        path, slug: opts.slug, title: opts.title, force: opts.force, dryRun: opts.dryRun,
        profile: g.profile, region: g.region, bucket: g.bucket, domain: g.domain, distribution: g.distribution,
      });
      console.log(url);
      if (opts.open && !opts.dryRun) runOpen({ id: url.split("/").slice(-2, -1)[0] });
    } catch (err) { fail(err); }
  });

program
  .command("list")
  .description("List published documents")
  .action(async () => {
    try {
      const rows = await listDocs(globals());
      console.log(formatRows(rows));
    } catch (err) { fail(err); }
  });

program
  .command("rm <id>")
  .description("Delete a document by code or slug")
  .option("--yes", "skip confirmation")
  .action(async (id, opts) => {
    try {
      await runRm({ id, yes: opts.yes, ...globals() });
      console.log(`Deleted ${id}.`);
    } catch (err) { fail(err); }
  });

program
  .command("open <id>")
  .description("Open a document's URL in your browser")
  .action((id) => {
    try {
      console.log(runOpen({ id, ...globals() }));
    } catch (err) { fail(err); }
  });

program
  .command("config")
  .description("Show the active configuration")
  .action(() => {
    try {
      console.log(describeConfig(globals()));
    } catch (err) { fail(err); }
  });

program.parseAsync();
