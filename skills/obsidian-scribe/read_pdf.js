const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// VAULT ROOT CONFIGURATION
const VAULT_ROOT = '/mnt/c/Users/Jherr/Documents/remote-personal/';

function resolveVaultPath(inputPath) {
    if (!inputPath) return inputPath;
    if (path.isAbsolute(inputPath)) return inputPath;
    
    const resolved = path.join(VAULT_ROOT, inputPath);
    console.log(`Resolved relative path '${inputPath}' to '${resolved}'`);
    return resolved;
}

const rawPath = process.argv[2];
const targetPath = resolveVaultPath(rawPath);

if (!targetPath) {
    console.error('Usage: node read_pdf.js <path_to_pdf>');
    process.exit(1);
}

if (!fs.existsSync(targetPath)) {
    console.error(`Error: File not found at ${targetPath}`);
    process.exit(1);
}

const dataBuffer = fs.readFileSync(targetPath);

pdf(dataBuffer).then(function(data) {
    // number of pages
    // console.log(data.numpages);
    // number of rendered pages
    // console.log(data.numrender);
    // PDF info
    // console.log(data.info);
    // PDF metadata
    // console.log(data.metadata); 
    // PDF.js version
    // console.log(data.version);
    // PDF text
    console.log(data.text);
}).catch(err => {
    console.error('Failed to parse PDF:', err);
    process.exit(1);
});
