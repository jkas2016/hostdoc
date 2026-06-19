import { execFileSync } from "node:child_process";
import { saveConfig, type Config } from "../lib/config.js";

interface TfOutput {
  value: unknown;
}

export function readTerraformOutputs(dir: string): Record<string, TfOutput> {
  const raw = execFileSync("terraform", [`-chdir=${dir}`, "output", "-json"], {
    encoding: "utf8",
  });
  return JSON.parse(raw) as Record<string, TfOutput>;
}

export function runInit(args: { dir: string }): Config {
  let outputs: Record<string, TfOutput>;
  try {
    outputs = readTerraformOutputs(args.dir);
  } catch (err) {
    throw new Error(
      `Could not read terraform outputs from "${args.dir}". ` +
        `Ensure terraform is installed and \`terraform apply\` has run there. ` +
        `(${(err as Error).message})`,
    );
  }

  const get = (key: string): string => {
    const v = outputs[key]?.value;
    if (typeof v !== "string" || !v) {
      throw new Error(`Missing terraform output: ${key}`);
    }
    return v;
  };

  const cfg: Config = {
    mode: "cloudfront",
    bucket: get("bucket_name"),
    region: get("region"),
    distributionId: get("distribution_id"),
    domain: get("site_domain"),
  };
  saveConfig(cfg);
  return cfg;
}
