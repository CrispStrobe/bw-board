import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FULL_SHA = /^[0-9a-f]{40}$/i;

const stripJsComments = source => {
    let out = '';
    let quote = null;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];
        if (quote) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            quote = c;
            out += c;
        } else if (c === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            out += '\n';
        } else if (c === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i++;
        } else {
            out += c;
        }
    }
    return out;
};

const checkoutSites = (file, source) => {
    const lines = source.split('\n');
    const sites = [];
    for (let i = 0; i < lines.length; i++) {
        const use = lines[i].match(/^(\s*)(?:-\s+)?uses:\s+actions\/checkout@([^\s#]+)/);
        if (!use) continue;
        const indent = use[1].length;
        let repository = null;
        let ref = null;
        for (let j = i + 1; j < lines.length; j++) {
            const current = lines[j];
            const currentIndent = current.match(/^\s*/)[0].length;
            if (current.trim() && currentIndent <= indent && /^\s*-/.test(current)) break;
            repository ||= current.match(/^\s*repository:\s*([^\s#]+)/)?.[1] || null;
            ref ||= current.match(/^\s*ref:\s*([^\s#]+)/)?.[1] || null;
        }
        if (repository) sites.push({kind: 'checkout', file, line: i + 1, repository, ref});
    }
    return sites;
};

const workflowScripts = source => [...source.matchAll(/\b(scripts\/[A-Za-z0-9._/-]+\.(?:mjs|js|sh))\b/g)]
    .map(match => match[1]);

const rawWorkflowClones = (file, source) => {
    const code = source.split('\n').map(line => line.replace(/\s+#.*$/, '')).join('\n');
    return [...code.matchAll(/\bgit\s+clone\b/g)].map(match => {
        const tail = code.slice(match.index, match.index + 300);
        const repository = tail.match(/https:\/\/github\.com\/[^\s"'\\]+/)?.[0] || 'git clone';
        return {kind: 'raw-workflow-clone', file,
            line: code.slice(0, match.index).split('\n').length, repository};
    });
};

const scriptCloneSites = (file, source) => {
    const shell = file.endsWith('.sh');
    const code = shell
        ? source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
        : stripJsComments(source);
    const sites = [];
    for (const match of code.matchAll(/(?:execFileSync|spawnSync|execFile|spawn|run)\(\s*['"]git['"]\s*,\s*\[\s*['"]clone['"]/g)) {
        sites.push({kind: 'script-clone', file, line: code.slice(0, match.index).split('\n').length});
    }
    if (shell) {
        for (const match of code.matchAll(/\bgit\s+clone\b[^\n]*?(https:\/\/github\.com\/[^\s"']+)/g)) {
            sites.push({kind: 'raw-script-clone', file, line: code.slice(0, match.index).split('\n').length,
                repository: match[1]});
        }
    }
    return sites;
};

export const auditExternalInputs = ({workflows, scripts}) => {
    const errors = [];
    const sites = [];
    const invoked = new Set();
    for (const [file, source] of workflows) {
        const checkouts = checkoutSites(file, source);
        sites.push(...checkouts);
        for (const site of checkouts) {
            if (!site.ref) errors.push(`${site.file}:${site.line} ${site.repository}: external checkout has no ref`);
            else if (!FULL_SHA.test(site.ref)) {
                errors.push(`${site.file}:${site.line} ${site.repository}: ref ${site.ref} is not a full 40-hex commit`);
            }
        }
        for (const site of rawWorkflowClones(file, source)) {
            sites.push(site);
            errors.push(`${site.file}:${site.line} ${site.repository}: raw workflow clone follows a moving ref`);
        }
        for (const script of workflowScripts(source)) invoked.add(script);
    }

    for (const file of invoked) {
        const source = scripts.get(file);
        if (source === undefined) {
            errors.push(`${file}: workflow-invoked script is absent from the audit corpus`);
            continue;
        }
        const clones = scriptCloneSites(file, source);
        sites.push(...clones);
        for (const site of clones) {
            if (file !== 'scripts/build-labwired-wasm.mjs' || site.kind !== 'script-clone') {
                errors.push(`${site.file}:${site.line} ${site.repository || 'git clone'}: executable script clone is not pinned by an audited contract`);
            }
        }
        if (file === 'scripts/build-labwired-wasm.mjs') {
            if (clones.length !== 1) {
                errors.push(`${file}: labwired build must have exactly one audited source clone; found ${clones.length}`);
            }
            const pin = source.match(/const PIN = ['"]([^'"]+)['"]/u)?.[1];
            if (!pin || !FULL_SHA.test(pin)) errors.push(`${file}: labwired-core PIN ${pin || '<missing>'} is not a full 40-hex commit`);
            if (!/const ref = arg\(['"]ref['"], PIN\)/.test(source)
                || !/run\(['"]git['"], \[['"]checkout['"], ['"]--quiet['"], ref\]/.test(source)) {
                errors.push(`${file}: labwired-core clone is not followed by checkout of the PIN-backed ref`);
            }
        }
    }
    return {errors, sites, invoked: [...invoked].sort()};
};

export const auditLiteralActionPins = files => {
    const errors = [];
    const sites = [];
    for (const [file, source] of files) {
        for (const [index, line] of source.split('\n').entries()) {
            const match = line.match(/^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
            if (!match) continue;
            const action = match[1] || match[2] || match[3];
            // This audit is deliberately limited to literal action references. Matrix/expression
            // construction has no stable owner/repository value for a source-text pin check.
            if (action.startsWith('./') || action.includes('${{')) continue;
            const site = {file, line: index + 1, action};
            sites.push(site);
            const at = action.lastIndexOf('@');
            if (at < 0) errors.push(`${file}:${index + 1} ${action}: literal third-party action has no revision`);
            else if (!FULL_SHA.test(action.slice(at + 1))) {
                errors.push(`${file}:${index + 1} ${action}: literal third-party action revision is not a full 40-hex commit`);
            }
        }
    }
    return {errors, sites};
};

const yamlFilesRecursively = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return yamlFilesRecursively(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
});

const liveCorpus = () => {
    const workflowDir = join(ROOT, '.github', 'workflows');
    const workflows = new Map(readdirSync(workflowDir)
        .filter(file => /\.ya?ml$/.test(file))
        .map(file => [`.github/workflows/${file}`, readFileSync(join(workflowDir, file), 'utf8')]));
    const invoked = new Set([...workflows.values()].flatMap(workflowScripts));
    const scripts = new Map([...invoked].map(file => [file, readFileSync(join(ROOT, file), 'utf8')]));
    return {workflows, scripts};
};

const liveGithubYaml = () => new Map(yamlFilesRecursively(join(ROOT, '.github'))
    .map(file => [relative(ROOT, file), readFileSync(file, 'utf8')]));

test('every executable external repository input used by CI resolves to a full commit', () => {
    const result = auditExternalInputs(liveCorpus());
    assert.deepEqual(result.errors, [], result.errors.join('\n'));
    const named = result.sites.map(site => site.repository).filter(Boolean);
    assert.ok(named.includes('SingleStepTests/z80'), 'the z80 vector input disappeared from the derived census');
    assert.ok(named.includes('SingleStepTests/65x02'), 'the 65x02 vector input disappeared from the derived census');
    assert.ok(result.invoked.includes('scripts/build-labwired-wasm.mjs'),
        'the workflow-invoked labwired clone left the derived script corpus');
    assert.equal(result.sites.filter(site => site.file === 'scripts/build-labwired-wasm.mjs').length, 1,
        'labwired build must have exactly one audited source clone');
    console.log(`# audited ${result.sites.length} external repository sites across workflows and invoked scripts`);
});

test('every literal third-party uses in YAML recursively under .github has a full commit', () => {
    const result = auditLiteralActionPins(liveGithubYaml());
    const scope = 'literal third-party uses: in YAML recursively under .github must use a full 40-hex commit; '
        + 'local ./ actions are exempt and constructed/expression uses are outside this literal source-text gate';
    assert.deepEqual(result.errors, [], `${scope}\n${result.errors.join('\n')}`);
    console.log(`# audited ${result.sites.length} literal third-party action sites recursively under .github`);
});

test('pin audit mutations fail by dependency and execution site', () => {
    const baseWorkflow = `steps:\n  - uses: actions/checkout@full\n    with:\n      repository: Acme/vectors\n      ref: 0123456789abcdef0123456789abcdef01234567\n  - run: node scripts/build-labwired-wasm.mjs\n`;
    const baseScript = `const PIN = '0123456789abcdef0123456789abcdef01234567';\nconst arg = () => PIN;\nconst ref = arg('ref', PIN);\nrun('git', ['clone', 'https://github.com/Acme/core.git']);\nrun('git', ['checkout', '--quiet', ref]);\n`;
    const fixture = (workflow = baseWorkflow, script = baseScript) => auditExternalInputs({
        workflows: new Map([['.github/workflows/ci.yml', workflow]]),
        scripts: new Map([['scripts/build-labwired-wasm.mjs', script]])
    }).errors.join('\n');

    assert.match(fixture(baseWorkflow.replace(/\n      ref: [^\n]+/, '')), /Acme\/vectors: external checkout has no ref/);
    assert.match(fixture(baseWorkflow.replace(/0123456789abcdef0123456789abcdef01234567/, '0123456')),
        /Acme\/vectors: ref 0123456 is not a full 40-hex commit/);
    assert.match(fixture(`${baseWorkflow}  - run: git clone --depth 1\n        https:\/\/github.com\/Acme\/moving target\n`),
        /Acme\/moving: raw workflow clone follows a moving ref/);
    assert.match(fixture(baseWorkflow,
        `${baseScript}\nrun('git', ['clone', 'https://github.com/Acme/moving.git']);`),
    /labwired build must have exactly one audited source clone; found 2/);
    assert.match(fixture(baseWorkflow, baseScript.replace(/0123456789abcdef0123456789abcdef01234567/, 'main')),
        /labwired-core PIN main is not a full 40-hex commit/);
});

test('literal action pin mutations fail by workflow and execution site', () => {
    const fixture = action => auditLiteralActionPins(new Map([
        ['.github/workflows/nested/fixture.yml', `steps:\n  - uses: ${action}\n`]
    ])).errors.join('\n');

    assert.match(fixture('actions/checkout@v4'),
        /.github\/workflows\/nested\/fixture.yml:2 actions\/checkout@v4: .*not a full 40-hex commit/);
    assert.match(fixture('actions/checkout'),
        /.github\/workflows\/nested\/fixture.yml:2 actions\/checkout: .*has no revision/);
    assert.match(fixture('actions/checkout@0123456'),
        /.github\/workflows\/nested\/fixture.yml:2 actions\/checkout@0123456: .*not a full 40-hex commit/);
    assert.deepEqual(auditLiteralActionPins(new Map([['.github/workflows/local.yml',
        'steps:\n  - uses: ./local-action\n  - uses: ${{ matrix.action }}\n']])).errors, []);
});
