const fs = require("fs");
const path = require("path");

const generatedDir = path.join(__dirname, "..", "src", "generated");

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replace(/from '(\.\.?\/[^']*)'/g, (_match, importPath) => {
    if (importPath.endsWith(".js") || importPath.endsWith(".cjs")) return _match;
    const abs = path.resolve(path.dirname(filePath), importPath);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return `from '${importPath}/index.js'`;
    }
    return `from '${importPath}.js'`;
  });
  fs.writeFileSync(filePath, content);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) fixFile(full);
  }
}

walk(generatedDir);
console.log("Fixed ESM imports in generated files");
