import { config } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';

config({ path: join(homedir(), '.follow-investors/.env') });

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK_URL;
const FEISHU_MAX_LENGTH = 4000;

async function deliverFeishu(text) {
  if (!FEISHU_WEBHOOK) {
    console.error('[Deliver] FEISHU_WEBHOOK_URL not set');
    process.exit(1);
  }

  const chunks = splitText(text, FEISHU_MAX_LENGTH);

  for (let i = 0; i < chunks.length; i++) {
    const title = chunks.length > 1
      ? `📊 AI 投资日报 (${i + 1}/${chunks.length})`
      : '📊 AI 投资日报';

    const body = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template: 'blue',
        },
        elements: [
          {
            tag: 'markdown',
            content: chunks[i],
          },
        ],
      },
    };

    const res = await fetch(FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Deliver] Feishu error (chunk ${i + 1}):`, errText);
    } else {
      console.log(`[Deliver] Feishu chunk ${i + 1}/${chunks.length} sent`);
    }

    if (i < chunks.length - 1) await sleep(500);
  }
}

async function deliverStdout(text) {
  process.stdout.write(text + '\n');
}

function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const method = process.argv[2] || 'stdout';

  // Read from stdin, --message, or --file
  let text = '';

  const msgIdx = process.argv.indexOf('--message');
  const fileIdx = process.argv.indexOf('--file');

  if (msgIdx !== -1) {
    text = process.argv[msgIdx + 1];
  } else if (fileIdx !== -1) {
    const { readFileSync } = await import('fs');
    text = readFileSync(process.argv[fileIdx + 1], 'utf-8');
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf-8');
  }

  if (!text.trim()) {
    console.error('[Deliver] No content to deliver');
    process.exit(1);
  }

  switch (method) {
    case 'feishu':
      await deliverFeishu(text);
      break;
    case 'stdout':
    default:
      await deliverStdout(text);
      break;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
