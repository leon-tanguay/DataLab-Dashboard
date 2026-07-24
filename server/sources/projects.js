// Projects source: pull the published Google Sheet as CSV, split into the
// currently-active projects (for the spotlight) and completed projects (for the
// scrolling marquee). Column names are matched loosely with fallbacks so small
// header edits in the sheet don't break the display.

import Papa from 'papaparse';
import { config } from '../config.js';

// Match a column by name. The sheet's headers carry long parenthetical suffixes
// (e.g. "Project Title (descriptive, ...)"), so we match on a case-insensitive
// prefix after trying an exact match.
function field(row, ...names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const target = n.toLowerCase();
    let key = keys.find((k) => k.toLowerCase() === target);
    if (!key) key = keys.find((k) => k.toLowerCase().startsWith(target));
    if (key && row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function imageUrl(v) {
  return /^https?:\/\//i.test(v) ? v : '';
}

// Accept real URLs and bare domains; reject junk like "NA", "no link", "TBD".
function cleanLink(v) {
  const s = (v || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return '';
}

// Split a delimited cell into clean tags. Strips inline notes like "[see note]"
// and leading symbols ("*Diversity" -> "Diversity"), then drops empties, generic
// "Other", and sheet placeholders ("read description", "TBD", "N/A", ...).
const PLACEHOLDER = /^(enter|read|see|write|add|fill|describe|tbd|n\/?a|none|todo|xxx|other)$|description|see\s*note/i;
function cleanTag(s) {
  return s
    .replace(/\[[^\]]*\]/g, '') // remove "[see note]" style annotations
    .replace(/["']/g, '') // stray quotes from CSV
    .replace(/^[^\p{L}\p{N}]+/u, '') // leading * / punctuation
    .trim();
}
function splitList(v) {
  if (!v) return [];
  return [
    ...new Set(
      v
        .split(/[;,|/]/)
        .map(cleanTag)
        .filter((s) => s && !PLACEHOLDER.test(s))
    ),
  ];
}

function firstName(person) {
  // "Michele; David" -> "Michele"; keep just the lead's name tidy.
  return person.split(/[;,]/)[0].trim();
}

// Extract a 4-digit year from a date cell like "10/24/2022" or "2021".
function yearOf(str) {
  const m = /((?:19|20)\d{2})/.exec(str || '');
  return m ? Number(m[1]) : null;
}

function mapRow(row) {
  const shortName = field(row, 'Unique project short name', 'Project slug');
  // The readable descriptive sentence lives in "Project Title (descriptive...)";
  // the short label in "Unique project short name"; "Long Project title" is the
  // formal funded title. Note: do NOT match "Blurb" — that hits "Blurb status".
  const descriptive = field(row, 'Project Title');
  const longTitle = field(row, 'Long Project title');
  const startYear = yearOf(field(row, 'Actual Start Date', 'Anticipated Start Date'));
  return {
    name: shortName,
    // Prefer the human-readable descriptive title for the big headline; fall back
    // to the formal long title, then the short internal name.
    title: descriptive || longTitle || shortName,
    longTitle,
    blurb: descriptive,
    lead: firstName(field(row, 'Technical Lead (for recharge purposes)', 'Sponsor')),
    facultyPartner: field(row, 'Primary Project Partner (faculty)'),
    department: field(row, 'Department', 'School, College, or External Partner'),
    domain: field(row, 'Domain'),
    themes: splitList(field(row, 'Themes')),
    approaches: splitList(field(row, 'Approaches')),
    link: cleanLink(field(row, 'Public Product Link', 'DataLab webpage url')),
    image: imageUrl(field(row, 'Image')),
    startYear,
    funded: /extern|grant|funded/i.test(field(row, 'Source', 'Category')),
    status: field(row, 'Status').toLowerCase(),
  };
}

export async function fetchProjects() {
  const res = await fetch(config.projects.csvUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Projects CSV HTTP ${res.status}`);
  const csv = await res.text();
  if (/^\s*</.test(csv)) throw new Error('Projects CSV returned HTML (sheet not public?)');

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' });
  const rows = parsed.data.map(mapRow);

  const active = rows
    .filter((p) => config.projects.activeStatuses.includes(p.status) && (p.title || p.name))
    .map((p) => ({ ...p, title: p.title || p.name }));

  const completed = rows
    .filter((p) => config.projects.completedStatuses.includes(p.status) && (p.name || p.title))
    .map((p) => ({ name: p.name || p.title, lead: p.lead, domain: p.domain, startYear: p.startYear }));

  // Scale/breadth stats across all real (active + completed) work — the headline
  // numbers that show a walk-in donor how much and how widely the lab operates.
  const real = rows.filter(
    (p) =>
      config.projects.activeStatuses.includes(p.status) ||
      config.projects.completedStatuses.includes(p.status)
  );
  const uniq = (vals) =>
    new Set(
      vals
        .map((v) => realish(v))
        .filter(Boolean)
        .map((v) => v.toLowerCase())
    ).size;
  const years = real.map((p) => p.startYear).filter(Boolean);
  const stats = {
    active: active.length,
    delivered: completed.length,
    partners: uniq(real.map((p) => p.facultyPartner)),
    departments: uniq(real.map((p) => p.department)),
    domains: uniq(real.map((p) => p.domain)),
    sinceYear: years.length ? Math.min(...years) : null,
  };

  return { active, completed, stats, counts: { active: active.length, completed: completed.length } };
}

// Treat sheet filler ("internal", "N/A", "TBD", "-") as no value for uniqueness counts.
function realish(v) {
  const s = (v || '').trim();
  return !s || /^(internal|n\/?a|tbd|none|-|—)$/i.test(s) ? '' : s;
}

// CLI: `npm run fetch:projects`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('projects.js')) {
  fetchProjects()
    .then((d) => {
      console.log(`Active: ${d.active.length}, Completed: ${d.completed.length}`);
      console.log(JSON.stringify(d.active.slice(0, 3), null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
