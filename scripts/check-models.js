const fs = require('fs');
const path = require('path');
const https = require('https');

// Simple .env parser since we can't rely on dependencies
function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${filePath}`);
        return {};
    }
    console.log(`✅ Reading file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    content.split(/\r?\n/).forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    });
    return env;
}

const envLocal = loadEnv(path.join(process.cwd(), '.env.local'));
const env = loadEnv(path.join(process.cwd(), '.env'));
const mergedEnv = { ...env, ...envLocal };

console.log("Found keys:", Object.keys(mergedEnv).join(", "));

const apiKey = mergedEnv.GEMINI_API_KEY || mergedEnv.GOOGLE_GENAI_API_KEY;

if (!apiKey) {
    console.error("❌ Could not find GOOGLE_GENAI_API_KEY or GEMINI_API_KEY in .env or .env.local");
    process.exit(1);
}

console.log("🔑 Using API Key ending in: ..." + apiKey.slice(-4));
console.log("📡 Fetching models from Google API...");

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error("❌ API Error:", json.error.message);
            } else if (json.models) {
                console.log("\n✅ Available Models:");
                json.models
                    .filter(m => m.name.includes('gemini'))
                    .forEach(m => {
                        console.log(`- ${m.name}`);
                    });
            } else {
                console.log("Unexpected response:", json);
            }
        } catch (e) {
            console.error("Error parsing response:", e);
        }
    });
}).on('error', err => {
    console.error("Network error:", err.message);
});
