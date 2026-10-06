// Copies node and credential icons into dist/, preserving the folder layout.
const fs = require('fs');
const path = require('path');

const ICON_EXTENSIONS = new Set(['.png', '.svg']);

function copyIcons(sourceDir, destinationDir) {
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const source = path.join(sourceDir, entry.name);
		const destination = path.join(destinationDir, entry.name);

		if (entry.isDirectory()) {
			copyIcons(source, destination);
		} else if (ICON_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			fs.mkdirSync(destinationDir, { recursive: true });
			fs.copyFileSync(source, destination);
		}
	}
}

for (const dir of ['nodes', 'credentials']) {
	copyIcons(path.resolve(dir), path.resolve('dist', dir));
}
