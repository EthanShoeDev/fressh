function collectJsonFindingTitles(value, findings) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonFindingTitles(item, findings);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (
    typeof value.title === "string" &&
    /^\[P\d\]\s+/.test(value.title.trim())
  ) {
    findings.add(value.title.trim());
  }

  for (const nestedValue of Object.values(value)) {
    collectJsonFindingTitles(nestedValue, findings);
  }
}

export function collectJsonFindingTitlesFromValue(value) {
  const findings = new Set();
  collectJsonFindingTitles(value, findings);
  return [...findings];
}

function normalizePriorityFinding(priority, findingText) {
  if (!priority || !findingText) {
    return null;
  }

  return `[${priority.toUpperCase()}] ${String(findingText).trim()}`;
}

function extractPriorityFindingFromBullet(rawBulletText) {
  const bulletText = String(rawBulletText ?? "").trim();
  if (!bulletText) {
    return null;
  }

  const boldWrappedMatch = bulletText.match(/^\*\*\[(P\d)\]\s+(.+)$/i);
  if (boldWrappedMatch) {
    return normalizePriorityFinding(
      boldWrappedMatch[1],
      boldWrappedMatch[2].replace(/\*\*\s*$/, "")
    );
  }

  const priorityBoldOnlyMatch = bulletText.match(/^\*\*\[(P\d)\]\*\*\s+(.+)$/i);
  if (priorityBoldOnlyMatch) {
    return normalizePriorityFinding(
      priorityBoldOnlyMatch[1],
      priorityBoldOnlyMatch[2]
    );
  }

  const plainMatch = bulletText.match(/^\[(P\d)\]\s+(.+)$/i);
  if (!plainMatch) {
    return null;
  }

  return normalizePriorityFinding(plainMatch[1], plainMatch[2]);
}

export function extractJsonFindingTitles(contents) {
  const findings = new Set();
  const normalizedContents = String(contents ?? "").trim();

  if (normalizedContents) {
    try {
      collectJsonFindingTitles(JSON.parse(normalizedContents), findings);
    } catch {
      for (const match of normalizedContents.matchAll(/"title"\s*:\s*"([^"\n]+)"/g)) {
        const title = (match[1] ?? "").replace(/\\"/g, "\"").trim();
        if (/^\[P\d\]\s+/.test(title)) {
          findings.add(title);
        }
      }
    }
  }

  return [...findings];
}

export function extractPriorityReviewFindings(contents) {
  const findings = new Set();
  const lines = String(contents ?? "").split(/\r?\n/);

  for (const rawLine of lines) {
    const lineMatch = rawLine.trimEnd().match(/^- (.+)$/);
    if (!lineMatch) {
      continue;
    }

    const normalizedFinding = extractPriorityFindingFromBullet(lineMatch[1]);
    if (normalizedFinding) {
      findings.add(normalizedFinding);
    }
  }

  for (const title of extractJsonFindingTitles(contents)) {
    findings.add(title);
  }

  return [...findings];
}
