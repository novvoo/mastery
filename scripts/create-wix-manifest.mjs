#!/usr/bin/env bun

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

const [stageDirArg, outputArg] = process.argv.slice(2);

if (!stageDirArg || !outputArg) {
  console.error('Usage: bun scripts/create-wix-manifest.mjs <stage-dir> <output.wxs>');
  process.exit(1);
}

const root = resolve(stageDirArg);
const output = resolve(outputArg);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manufacturer = 'novvoo';
const upgradeCode = '5E892847-5AD4-4E84-B7D6-5F34C8DB62E0';

let idCounter = 0;
const rootDirectory = { id: 'INSTALLFOLDER', name: packageJson.name, children: [] };
const componentFragments = [];
const componentRefs = [];

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function walkDirectory(absDir, directoryNode) {
  const entries = readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = join(absDir, entry.name);

    if (entry.isDirectory()) {
      const child = {
        id: nextId('DIR'),
        name: entry.name,
        children: [],
      };
      directoryNode.children.push(child);
      walkDirectory(absPath, child);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(root, absPath).split(sep).join('/');
    const componentId = nextId('CMP');
    const fileId = nextId('FILE');
    componentRefs.push(`<ComponentRef Id="${componentId}" />`);
    componentFragments.push(`
      <Component Id="${componentId}" Directory="${directoryNode.id}" Guid="*">
        <File Id="${fileId}" Source="${xml(absPath)}" Name="${xml(entry.name)}" KeyPath="yes" />
      </Component>`);

    if (relativePath === 'bin/agent.cmd') {
      const pathComponentId = nextId('CMP');
      componentFragments.push(`
      <Component Id="${pathComponentId}" Directory="${directoryNode.id}" Guid="*">
        <Environment Id="${nextId('ENV')}" Name="PATH" Value="[INSTALLFOLDER]bin" Permanent="no" Part="last" Action="set" System="yes" />
        <RegistryValue Root="HKLM" Key="Software\\${xml(manufacturer)}\\${xml(packageJson.name)}" Name="installed" Type="integer" Value="1" KeyPath="yes" />
      </Component>`);
      componentRefs.push(`<ComponentRef Id="${pathComponentId}" />`);
    }
  }
}

function renderDirectory(node, indent = '      ') {
  const childXml = node.children.map(child => renderDirectory(child, `${indent}  `)).join('\n');
  if (!childXml) {
    return `${indent}<Directory Id="${node.id}" Name="${xml(node.name)}" />`;
  }
  return `${indent}<Directory Id="${node.id}" Name="${xml(node.name)}">\n${childXml}\n${indent}</Directory>`;
}

walkDirectory(root, rootDirectory);

const wxs = `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="${xml(packageJson.name)}"
    Manufacturer="${xml(manufacturer)}"
    Version="${xml(packageJson.version)}"
    UpgradeCode="${upgradeCode}"
    Scope="perMachine">
    <MajorUpgrade
      AllowSameVersionUpgrades="yes"
      DowngradeErrorMessage="A newer version of ${xml(packageJson.name)} is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <StandardDirectory Id="ProgramFilesFolder">
${renderDirectory(rootDirectory, '      ')}
    </StandardDirectory>

    <Feature Id="MainFeature" Title="${xml(packageJson.name)}" Level="1">
      ${componentRefs.join('\n      ')}
    </Feature>

    ${componentFragments.join('\n')}
  </Package>
</Wix>
`;

writeFileSync(output, wxs);
console.log(output);
