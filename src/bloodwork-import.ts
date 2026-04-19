import {
  getBloodworkBiomarker,
} from "./bloodwork.js";
import type {
  ImportConfidence,
  LabBiomarker,
  LabImportFormat,
  LabImportMetadata,
  LabImportPreview,
  LabNormalizationNote,
  LabPanel,
  LabResult,
} from "./types.js";
import { generateId, toIsoDateTime } from "./utils.js";

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function detectImportFormat(rawData: string, fileName?: string): LabImportFormat {
  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".tsv")) {
    return "tsv";
  }
  if (lowerName.endsWith(".csv")) {
    return "csv";
  }

  const lines = rawData.split(/\r?\n/).filter(Boolean);
  const first = lines[0] ?? "";
  if (first.includes("\t")) {
    return "tsv";
  }
  if (first.includes(",")) {
    return "csv";
  }
  return "text";
}

function splitDelimited(line: string, delimiter: string) {
  if (!line.includes("\"")) {
    return line.split(delimiter).map((part) => part.trim());
  }
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseNumeric(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function convertUnit(id: string, value: number, unit: string, targetUnit: string) {
  const source = normalizeToken(unit);
  const target = normalizeToken(targetUnit);
  if (!source || source === target) {
    return { value, unit: targetUnit, note: null as string | null };
  }

  const convert = (nextValue: number, note: string) => ({ value: Number(nextValue.toFixed(2)), unit: targetUnit, note });

  if (source === "mmoll" && target === "mgdl") {
    if (id === "glucose") {
      return convert(value * 18, `Converted ${unit} to ${targetUnit} using glucose mmol/L → mg/dL normalization.`);
    }
    if (["ldl", "hdl", "total-cholesterol", "apolipoprotein-b", "apolipoprotein-a1"].includes(id)) {
      return convert(value * 38.67, `Converted ${unit} to ${targetUnit} using cholesterol mmol/L → mg/dL normalization.`);
    }
    if (id === "triglycerides") {
      return convert(value * 88.57, `Converted ${unit} to ${targetUnit} using triglycerides mmol/L → mg/dL normalization.`);
    }
  }

  if (source === "nmoll" && target === "ngml" && id === "vitamin-d") {
    return convert(value / 2.496, `Converted ${unit} to ${targetUnit} using vitamin D nmol/L → ng/mL normalization.`);
  }

  if ((source === "umoll" || source === "μmoll") && target === "mgdl" && id === "creatinine") {
    return convert(value / 88.4, `Converted ${unit} to ${targetUnit} using creatinine µmol/L → mg/dL normalization.`);
  }

  if ((source === "ugl" || source === "mgl") && target === "ngml" && id === "ferritin") {
    return convert(value, `Normalized ${unit} to ${targetUnit} using 1:1 ferritin mass conversion.`);
  }

  return { value, unit, note: null as string | null };
}

function normalizeReferenceRange(input: {
  biomarkerId: string;
  definitionUnit: string;
  sourceUnit: string;
  rawValue?: number;
  row: number;
  biomarkerName: string;
  normalizationNotes: LabNormalizationNote[];
}) {
  if (input.rawValue === undefined) {
    return undefined;
  }

  if (!input.sourceUnit || normalizeToken(input.sourceUnit) === normalizeToken(input.definitionUnit)) {
    return input.rawValue;
  }

  const converted = convertUnit(input.biomarkerId, input.rawValue, input.sourceUnit, input.definitionUnit);
  if (normalizeToken(converted.unit) === normalizeToken(input.definitionUnit) && converted.note) {
    return converted.value;
  }

  input.normalizationNotes.push({
    row: input.row,
    biomarkerName: input.biomarkerName,
    message: `Reference range for ${input.biomarkerName} was omitted because ${input.sourceUnit} could not be safely normalized to ${input.definitionUnit}.`,
    severity: "warning",
  });
  return undefined;
}

function pickField(record: Record<string, string>, aliases: string[]) {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.includes(normalizeToken(key))) {
      return value;
    }
  }
  return undefined;
}

function buildRecordFromDelimited(header: string[], values: string[]) {
  return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
}

function parseDelimitedRows(rawData: string, format: LabImportFormat) {
  const delimiter = format === "tsv" ? "\t" : ",";
  const lines = rawData.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const header = splitDelimited(lines[0], delimiter);
  return lines.slice(1).map((line, index) => ({
    row: index + 2,
    record: buildRecordFromDelimited(header, splitDelimited(line, delimiter)),
  }));
}

function parseTextRows(rawData: string) {
  const rows: Array<{ row: number; record: Record<string, string> }> = [];
  for (const [index, line] of rawData.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.includes(":") ? ":" : trimmed.includes("-") ? "-" : null;
    if (separator) {
      const [left, ...rest] = trimmed.split(separator);
      const right = rest.join(separator).trim();
      const match = right.match(/^([-+]?\d+(?:\.\d+)?)\s*([A-Za-z%\/µμ0-9.-]+)?/);
      if (match) {
        rows.push({
          row: index + 1,
          record: {
            name: left.trim(),
            value: match[1] ?? "",
            unit: match[2] ?? "",
          },
        });
      }
    }
  }
  return rows;
}

export function previewLabImport(input: {
  rawData: string;
  fileName?: string;
  defaultPanelName?: string;
}): LabImportPreview {
  const format = detectImportFormat(input.rawData, input.fileName);
  const rows = format === "text" ? parseTextRows(input.rawData) : parseDelimitedRows(input.rawData, format);
  const panels = new Map<string, LabBiomarker[]>();
  const normalizationNotes: LabNormalizationNote[] = [];
  const unmatchedRows: string[] = [];
  let matchedRows = 0;

  for (const row of rows) {
    const record = row.record;
    const name = pickField(record, ["name", "test", "analyte", "biomarker"]) ?? record.name ?? "";
    const value = parseNumeric(pickField(record, ["value", "result", "measurement"]) ?? record.value);
    const unit = pickField(record, ["unit", "units"]) ?? record.unit ?? "";
    const panelName = pickField(record, ["panel", "category", "section"]) ?? input.defaultPanelName ?? "Imported Panel";

    if (!name || value === undefined) {
      unmatchedRows.push(`Row ${row.row}: missing biomarker name or numeric value.`);
      continue;
    }

    const definition = getBloodworkBiomarker(name);
    if (!definition) {
      unmatchedRows.push(`Row ${row.row}: "${name}" did not match the biomarker catalogue.`);
      continue;
    }

    matchedRows += 1;
    const converted = convertUnit(definition.id, value, unit, definition.unit);
    if (converted.note) {
      normalizationNotes.push({
        row: row.row,
        biomarkerName: name,
        message: converted.note,
        severity: "info",
      });
    } else if (unit && normalizeToken(unit) !== normalizeToken(definition.unit)) {
      normalizationNotes.push({
        row: row.row,
        biomarkerName: name,
        message: `Stored ${name} using source unit ${unit} because no safe conversion to ${definition.unit} is defined yet.`,
        severity: "warning",
      });
    }

    const referenceRangeLow = normalizeReferenceRange({
      biomarkerId: definition.id,
      definitionUnit: definition.unit,
      sourceUnit: unit,
      rawValue: parseNumeric(pickField(record, ["referencerangelow", "ref_low", "low"])),
      row: row.row,
      biomarkerName: name,
      normalizationNotes,
    });
    const referenceRangeHigh = normalizeReferenceRange({
      biomarkerId: definition.id,
      definitionUnit: definition.unit,
      sourceUnit: unit,
      rawValue: parseNumeric(pickField(record, ["referencerangehigh", "ref_high", "high"])),
      row: row.row,
      biomarkerName: name,
      normalizationNotes,
    });

    const biomarker: LabBiomarker = {
      name: definition.name,
      sourceName: name,
      value: converted.value,
      unit: converted.unit,
      referenceRangeLow,
      referenceRangeHigh,
    };

    const list = panels.get(panelName) ?? [];
    list.push(biomarker);
    panels.set(panelName, list);
  }

  const confidence: ImportConfidence = matchedRows === 0
    ? "low"
    : unmatchedRows.length === 0 && !normalizationNotes.some((note) => note.severity === "warning")
      ? "high"
      : "medium";

  return {
    format,
    panels: Array.from(panels.entries()).map(([name, biomarkers]) => ({ name, biomarkers })),
    matchedRows,
    unmatchedRows,
    confidence,
    normalizationNotes,
  };
}

export function buildLabImportMetadata(preview: LabImportPreview, fileName?: string): LabImportMetadata {
  return {
    fileName,
    format: preview.format,
    matchedRows: preview.matchedRows,
    unmatchedRows: preview.unmatchedRows,
    confidence: preview.confidence,
    importedAt: toIsoDateTime(),
    normalizationNotes: preview.normalizationNotes.map((note) => note.message),
  };
}

export function buildImportedLabResult(input: {
  labName: string;
  rawData: string;
  fileName?: string;
  resultedAt?: string;
  defaultPanelName?: string;
  notes?: string;
}): { preview: LabImportPreview; labResult: LabResult } {
  const preview = previewLabImport({
    rawData: input.rawData,
    fileName: input.fileName,
    defaultPanelName: input.defaultPanelName,
  });

  return {
    preview,
    labResult: {
      id: generateId(),
      resultedAt: toIsoDateTime(input.resultedAt),
      labName: input.labName,
      panels: preview.panels,
      notes: input.notes,
      importMetadata: buildLabImportMetadata(preview, input.fileName),
    },
  };
}
