// Sets the admin dashboard password.
//
//   node tools/set-admin-password.mjs
//
// Prompts twice with the input hidden, writes ADMIN_PASSWORD_HASH into .env,
// and prints the same value to paste into Vercel. The password itself is never
// written anywhere, never echoed, and never lands in shell history — only the
// scrypt hash, which can't be reversed back into the password.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../api/_lib/adminAuth.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const VAR = "ADMIN_PASSWORD_HASH";
const MIN_LENGTH = 10;

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("needs an interactive terminal — run this directly, not piped"));
      return;
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      resolve(value);
    };

    // Raw mode delivers whole chunks, not single keys, so a pasted password
    // arrives at once and has to be walked character by character.
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Replaces the variable in place if it's already there, so the surrounding
// comments and ordering of .env survive.
function writeEnvVar(contents, name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  if (re.test(contents)) return contents.replace(re, line);
  return contents.replace(/\n*$/, "\n") + line + "\n";
}

const password = await promptHidden("New admin password: ");
if (password.length < MIN_LENGTH) {
  console.error(`\nToo short — use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
const again = await promptHidden("Confirm password:   ");
if (password !== again) {
  console.error("\nThose didn't match. Nothing was changed.");
  process.exit(1);
}

const hash = hashPassword(password);
if (!verifyPassword(password, hash)) {
  console.error("\nSanity check failed — refusing to write a hash that doesn't verify.");
  process.exit(1);
}

let contents = "";
try {
  contents = fs.readFileSync(ENV_PATH, "utf8");
} catch {
  console.error(`\nNo .env at ${ENV_PATH}. Create it first.`);
  process.exit(1);
}

const updated = writeEnvVar(contents, VAR, hash);
const existed = updated !== contents && new RegExp(`^${VAR}=`, "m").test(contents);
fs.writeFileSync(ENV_PATH, updated);

console.log(`\n${existed ? "Updated" : "Added"} ${VAR} in .env\n`);
console.log("Paste this into Vercel (Settings -> Environment Variables):\n");
console.log(`  ${VAR}`);
console.log(`  ${hash}\n`);
console.log("Then restart `npm start` locally — env vars are read at startup.");
console.log("Changing the password signs out every existing session.");
