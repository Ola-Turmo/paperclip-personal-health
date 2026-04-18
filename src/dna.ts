import { createHash } from "node:crypto";
import annotationFile from "./dna/annotations.json";
import type {
  AlleleEffect,
  DnaDiploidType,
  DnaDiseaseRisk,
  DnaEvidenceTier,
  DnaHealthInsight,
  DnaInsightCategory,
  DnaPathwaySummary,
  DnaPharmacogenomicInteraction,
  DnaPriorityFinding,
  DnaReport,
  DnaSource,
  DnaVariant,
  DnaVariantAnnotation,
} from "./types.js";
import { generateId, round } from "./utils.js";

interface AnnotationBundle {
  variants: DnaVariantAnnotation[];
}

const annotations = (annotationFile as AnnotationBundle).variants;
const annotationMap = new Map(annotations.map((annotation) => [annotation.rsId.toLowerCase(), annotation]));

const ancestrySignals: Record<string, Record<string, number>> = {
  rs12913832: { "Northern European": 0.45 },
  rs16891982: { European: 0.35 },
  rs1426654: { European: 0.35, South_Asian: 0.1 },
  rs671: { East_Asian: 0.5 },
  rs4988235: { European: 0.4 },
};

function normalizeAlleleKey(value: string): string {
  return value.replace(/[^A-Z]/gi, "").toUpperCase();
}

function inferEvidenceTier(annotation: DnaVariantAnnotation): DnaEvidenceTier {
  if (annotation.category === "pharmacogenomics") {
    return 2;
  }
  if (annotation.category === "cardiovascular" || annotation.category === "risk") {
    return 2;
  }
  if (annotation.category === "nutrition" || annotation.category === "fitness" || annotation.category === "metabolic" || annotation.category === "sleep") {
    return 3;
  }
  return 4;
}

function evidenceLabel(tier: DnaEvidenceTier): string {
  switch (tier) {
    case 1:
      return "Practice guideline";
    case 2:
      return "Curated clinical evidence";
    case 3:
      return "Replicated research";
    default:
      return "Preliminary research";
  }
}

function resolveActionableRecommendation(annotation: DnaVariantAnnotation, genotype: string): string | undefined {
  const matched = annotation.alleleEffects?.find((effect) => normalizeAlleleKey(effect.allele) === genotype);
  if (matched) {
    return matched.summary;
  }

  const simplified = annotation.alleleEffects?.find((effect) => genotype.includes(normalizeAlleleKey(effect.allele)));
  return simplified?.summary;
}

function inferDiploidType(genotype: string, annotation: DnaVariantAnnotation): DnaDiploidType {
  if (genotype.length < 2 || genotype[0] !== genotype[1]) {
    return "heterozygous";
  }

  const baseline = annotation.alleleEffects?.[0]?.allele ? normalizeAlleleKey(annotation.alleleEffects[0].allele) : genotype;
  return baseline === genotype ? "homozygousdominant" : "homozygousrecessive";
}

function classifyClinicalSignificance(annotation: DnaVariantAnnotation): string {
  if (annotation.impact === "risk") {
    return "watch";
  }
  if (annotation.impact === "positive") {
    return "beneficial";
  }
  return "informational";
}

function buildInsight(annotation: DnaVariantAnnotation, variant: DnaVariant): DnaHealthInsight {
  const tier = inferEvidenceTier(annotation);
  return {
    id: generateId(),
    category: annotation.category,
    title: annotation.title,
    description: `${annotation.description} Your observed genotype is ${variant.genotype}.`,
    impact: annotation.impact,
    relevantVariants: [variant.rsId],
    actionableRecommendation: resolveActionableRecommendation(annotation, variant.genotype),
    source: `Curated ${annotation.gene} knowledge base`,
    evidenceTier: tier,
    evidenceLabel: evidenceLabel(tier),
  };
}

function inferAncestry(variants: DnaVariant[]) {
  const scores: Record<string, number> = {};

  for (const variant of variants) {
    const signal = ancestrySignals[variant.rsId.toLowerCase()] ?? ancestrySignals[variant.rsId];
    if (!signal) {
      continue;
    }

    for (const [group, weight] of Object.entries(signal)) {
      scores[group] = (scores[group] ?? 0) + weight;
    }
  }

  const entries = Object.entries(scores);
  if (!entries.length) {
    return undefined;
  }

  const total = entries.reduce((acc, [, value]) => acc + value, 0);
  const detail = Object.fromEntries(entries.map(([group, value]) => [group, round(value / total, 2)]));
  const [topGroup] = entries.sort((left, right) => right[1] - left[1])[0];
  return {
    overall: topGroup.replace(/_/g, " "),
    detail,
  };
}

function parse23AndMe(lines: string[]) {
  return lines
    .filter((line) => line && !line.startsWith("#"))
    .slice(1)
    .map((line) => line.split(/\t/))
    .map(([rsid, chromosome, position, genotype]) => ({
      rsId: rsid,
      chromosome,
      position: Number(position),
      allele1: genotype?.[0] ?? "",
      allele2: genotype?.[1] ?? genotype?.[0] ?? "",
      genotype: normalizeAlleleKey(genotype ?? ""),
    }))
    .filter((row) => row.rsId && row.genotype && row.genotype !== "--");
}

function parseAncestry(lines: string[]) {
  return lines
    .filter((line) => line && !line.startsWith("#"))
    .slice(1)
    .map((line) => line.split(/\t/))
    .map(([rsid, chromosome, position, allele1, allele2]) => ({
      rsId: rsid,
      chromosome,
      position: Number(position),
      allele1: allele1 ?? "",
      allele2: allele2 ?? "",
      genotype: normalizeAlleleKey(`${allele1 ?? ""}${allele2 ?? ""}`),
    }))
    .filter((row) => row.rsId && row.genotype && row.genotype !== "--");
}

export function getAnnotationIndex() {
  return annotations;
}

export function detectDnaSource(raw: string, fileName?: string): DnaSource {
  const normalized = raw.slice(0, 500).toLowerCase();
  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.includes("ancestry") || normalized.includes("# ancestrydna") || normalized.includes("allele 1")) {
    return "ancestrydna";
  }
  if (lowerName.includes("23andme") || normalized.includes("23andme") || normalized.includes("genotype")) {
    return "23andme";
  }
  return "other";
}

export function parseRawDnaReport(input: {
  rawData: string;
  fileName?: string;
  notes?: string;
  privacyMode?: "living" | "privacy";
}): Omit<DnaReport, "id" | "uploadDate"> {
  const rawData = input.rawData.trim();
  const source = detectDnaSource(rawData, input.fileName);
  const lines = rawData.split(/\r?\n/);
  const parsed = source === "ancestrydna" ? parseAncestry(lines) : parse23AndMe(lines);
  const matchedVariants: DnaVariant[] = [];
  const insights: DnaHealthInsight[] = [];

  for (const row of parsed) {
    const annotation = annotationMap.get(row.rsId.toLowerCase());
    if (!annotation) {
      continue;
    }

    const variant: DnaVariant = {
      rsId: row.rsId,
      chromosome: row.chromosome,
      position: row.position,
      allele1: row.allele1,
      allele2: row.allele2,
      genotype: row.genotype,
      diploidType: inferDiploidType(row.genotype, annotation),
      clinicalSignificance: classifyClinicalSignificance(annotation),
      annotations: {
        gene: annotation.gene,
        category: annotation.category,
        title: annotation.title,
      },
    };

    matchedVariants.push(variant);
    insights.push(buildInsight(annotation, variant));
  }

  return {
    source,
    fileName: input.fileName,
    fileHash: createHash("sha256").update(rawData).digest("hex"),
    ancestryComposition: inferAncestry(matchedVariants),
    healthInsights: insights,
    variants: matchedVariants,
    rawSnpsImported: parsed.length,
    snpsMatchedToKnowledgeBase: matchedVariants.length,
    notes: input.notes,
    privacyMode: input.privacyMode ?? "living",
  };
}

export function createDnaReport(input: {
  rawData?: string;
  fileName?: string;
  notes?: string;
  source?: DnaSource;
  variants?: DnaVariant[];
  healthInsights?: DnaHealthInsight[];
  ancestryComposition?: DnaReport["ancestryComposition"];
  rawSnpsImported?: number;
  snpsMatchedToKnowledgeBase?: number;
  privacyMode?: "living" | "privacy";
}): DnaReport {
  if (input.rawData) {
    const parsed = parseRawDnaReport({
      rawData: input.rawData,
      fileName: input.fileName,
      notes: input.notes,
      privacyMode: input.privacyMode,
    });

    return {
      id: generateId(),
      uploadDate: new Date().toISOString(),
      ...parsed,
    };
  }

  return {
    id: generateId(),
    uploadDate: new Date().toISOString(),
    source: input.source ?? "other",
    fileName: input.fileName,
    ancestryComposition: input.ancestryComposition,
    healthInsights: input.healthInsights ?? [],
    variants: input.variants ?? [],
    rawSnpsImported: input.rawSnpsImported ?? input.variants?.length ?? 0,
    snpsMatchedToKnowledgeBase: input.snpsMatchedToKnowledgeBase ?? input.healthInsights?.length ?? 0,
    notes: input.notes,
    privacyMode: input.privacyMode ?? "living",
  };
}

export function groupInsightsByCategory(report: DnaReport, category?: DnaInsightCategory) {
  const insights = category
    ? report.healthInsights.filter((insight) => insight.category === category)
    : report.healthInsights;

  return insights.reduce<Record<string, DnaHealthInsight[]>>((acc, insight) => {
    acc[insight.category] ??= [];
    acc[insight.category].push(insight);
    return acc;
  }, {});
}

export function findVariantDetail(report: DnaReport, rsId: string) {
  const variant = report.variants.find((entry) => entry.rsId.toLowerCase() === rsId.toLowerCase());
  const annotation = annotationMap.get(rsId.toLowerCase());
  if (!variant) {
    return null;
  }

  return {
    variant,
    annotation,
    matchingInsights: report.healthInsights.filter((insight) => insight.relevantVariants.some((entry) => entry.toLowerCase() === rsId.toLowerCase())),
  };
}

export function lookupRsidAcrossReports(reports: DnaReport[], rsId: string) {
  const normalized = rsId.toLowerCase();
  return reports
    .map((report) => ({
      reportId: report.id,
      uploadDate: report.uploadDate,
      source: report.source,
      detail: findVariantDetail(report, normalized),
    }))
    .filter((entry) => entry.detail !== null);
}

export function compareDnaReports(left: DnaReport, right: DnaReport) {
  const leftMap = new Map(left.variants.map((variant) => [variant.rsId.toLowerCase(), variant]));
  const rightMap = new Map(right.variants.map((variant) => [variant.rsId.toLowerCase(), variant]));
  const allRsIds = new Set([...leftMap.keys(), ...rightMap.keys()]);

  const changedVariants = Array.from(allRsIds).flatMap((rsId) => {
    const before = leftMap.get(rsId);
    const after = rightMap.get(rsId);
    if (!before || !after) {
      return [{ rsId, before, after, status: before ? "removed" : "added" }];
    }
    if (before.genotype !== after.genotype) {
      return [{ rsId, before, after, status: "changed" }];
    }
    return [];
  });

  return {
    leftReportId: left.id,
    rightReportId: right.id,
    changedVariants,
    insightDelta: right.healthInsights.length - left.healthInsights.length,
    summary: `${changedVariants.length} variant changes, ${right.healthInsights.length} insights in newer report`,
  };
}

function protocolLine(title: string, insight: DnaHealthInsight) {
  const action = insight.actionableRecommendation ? ` — ${insight.actionableRecommendation}` : "";
  return `- **${title}:** ${insight.evidenceLabel ?? "Research signal"}${action}`;
}

function scoreInsightPriority(insight: DnaHealthInsight) {
  const impactWeight = insight.impact === "risk" ? 3 : insight.impact === "positive" ? 1 : 0;
  const evidenceWeight = 5 - (insight.evidenceTier ?? 4);
  const actionWeight = insight.actionableRecommendation ? 2 : 0;
  const categoryWeight = insight.category === "pharmacogenomics"
    ? 3
    : insight.category === "cardiovascular" || insight.category === "metabolic"
      ? 2
      : 1;
  return impactWeight + evidenceWeight + actionWeight + categoryWeight;
}

function extractGenes(report: DnaReport, insight: DnaHealthInsight) {
  return insight.relevantVariants
    .map((rsId) => annotationMap.get(rsId.toLowerCase())?.gene)
    .filter((gene): gene is string => Boolean(gene));
}

function inferRiskDomain(insight: DnaHealthInsight) {
  if (insight.category === "cardiovascular") {
    return "Cardiovascular";
  }
  if (insight.category === "metabolic" || /glucose|insulin|weight|lipid|obesity/i.test(insight.title)) {
    return "Metabolic";
  }
  if (insight.category === "sleep") {
    return "Sleep & Circadian";
  }
  if (insight.category === "nutrition") {
    return "Nutrient Handling";
  }
  if (/apoe|alzheimer|cognition|memory/i.test(insight.title)) {
    return "Neurocognitive";
  }
  return "General Wellness";
}

function pathwayForInsight(insight: DnaHealthInsight, report: DnaReport) {
  const genes = extractGenes(report, insight);
  if (insight.category === "pharmacogenomics" || genes.some((gene) => /^CYP|COMT|SLCO|ABCG/i.test(gene))) {
    return "Drug Response & Stimulant Handling";
  }
  if (insight.category === "nutrition" || genes.some((gene) => /MTHFR|MTRR|PEMT|VDR|GC|FUT2/i.test(gene))) {
    return "Methylation & Nutrient Handling";
  }
  if (insight.category === "cardiovascular" || insight.category === "metabolic" || genes.some((gene) => /APOE|FTO|TCF|PPAR|LPL/i.test(gene))) {
    return "Cardiometabolic Resilience";
  }
  if (insight.category === "sleep" || genes.some((gene) => /PER|CLOCK|ARNTL|ADORA/i.test(gene))) {
    return "Sleep & Circadian Regulation";
  }
  if (insight.category === "fitness" || genes.some((gene) => /ACTN3|ACE|ADRB2/i.test(gene))) {
    return "Training Response & Recovery";
  }
  return "General Health Signalling";
}

function medicationsForInsight(insight: DnaHealthInsight, report: DnaReport) {
  const genes = extractGenes(report, insight);
  const combined = `${insight.title} ${genes.join(" ")}`.toLowerCase();

  if (combined.includes("cyp1a2") || combined.includes("caffeine")) {
    return ["caffeine", "stimulants"];
  }
  if (combined.includes("cyp2c19")) {
    return ["SSRIs", "clopidogrel", "proton-pump inhibitors"];
  }
  if (combined.includes("cyp2d6")) {
    return ["codeine", "tramadol", "many antidepressants"];
  }
  if (combined.includes("comt")) {
    return ["stimulants", "dopamine-sensitive medications"];
  }
  if (combined.includes("apoe")) {
    return ["lipid-lowering strategy review with clinician"];
  }
  return ["review relevant prescriptions with clinician"];
}

export function buildActionableProtocol(report: DnaReport) {
  const byCategory = groupInsightsByCategory(report);

  return {
    nutrition: (byCategory.nutrition ?? []).slice(0, 3).map((insight) => protocolLine(insight.title, insight)),
    training: (byCategory.fitness ?? []).slice(0, 3).map((insight) => protocolLine(insight.title, insight)),
    cardiovascular: (byCategory.cardiovascular ?? []).slice(0, 2).map((insight) => protocolLine(insight.title, insight)),
    sleep: (byCategory.sleep ?? []).slice(0, 2).map((insight) => protocolLine(insight.title, insight)),
    pharmacogenomics: (byCategory.pharmacogenomics ?? []).slice(0, 4).map((insight) => protocolLine(insight.title, insight)),
  };
}

export function getPriorityFindings(report: DnaReport): DnaPriorityFinding[] {
  return report.healthInsights
    .slice()
    .sort((left, right) => scoreInsightPriority(right) - scoreInsightPriority(left))
    .slice(0, 10)
    .map((insight) => ({
      gene: extractGenes(report, insight)[0] ?? "Unknown",
      title: insight.title,
      category: insight.category,
      impact: insight.impact,
      evidenceLabel: insight.evidenceLabel,
      actionableRecommendation: insight.actionableRecommendation,
      relevantVariants: insight.relevantVariants,
      priorityScore: scoreInsightPriority(insight),
    }));
}

export function summarizeDiseaseRisks(report: DnaReport): DnaDiseaseRisk[] {
  const riskInsights = report.healthInsights.filter((insight) => insight.impact === "risk");
  const grouped = riskInsights.reduce<Record<string, DnaHealthInsight[]>>((acc, insight) => {
    const domain = inferRiskDomain(insight);
    acc[domain] ??= [];
    acc[domain].push(insight);
    return acc;
  }, {});

  return Object.entries(grouped).map(([domain, insights]) => {
    const peakScore = Math.max(...insights.map(scoreInsightPriority));
    const level: DnaDiseaseRisk["level"] = peakScore >= 8 ? "high" : peakScore >= 5 ? "moderate" : "low";
    return {
      domain,
      level,
      rationale: insights.map((insight) => insight.title).slice(0, 2).join("; "),
      genes: Array.from(new Set(insights.flatMap((insight) => extractGenes(report, insight)))),
      supportingInsights: insights.map((insight) => insight.title),
      monitoringSuggestions: insights
        .flatMap((insight) => [insight.actionableRecommendation ?? "", `${domain} markers and symptoms review`])
        .filter(Boolean)
        .slice(0, 3),
    };
  }).sort((left, right) => left.domain.localeCompare(right.domain));
}

export function summarizePharmacogenomics(report: DnaReport): DnaPharmacogenomicInteraction[] {
  return report.healthInsights
    .filter((insight) => insight.category === "pharmacogenomics")
    .slice()
    .sort((left, right) => scoreInsightPriority(right) - scoreInsightPriority(left))
    .map((insight) => ({
      gene: extractGenes(report, insight)[0] ?? "Unknown",
      medications: medicationsForInsight(insight, report),
      summary: insight.actionableRecommendation ?? insight.description,
      evidenceLabel: insight.evidenceLabel,
      relevantVariants: insight.relevantVariants,
    }));
}

export function summarizeGeneticPathways(report: DnaReport): DnaPathwaySummary[] {
  const grouped = report.healthInsights.reduce<Record<string, DnaHealthInsight[]>>((acc, insight) => {
    const pathway = pathwayForInsight(insight, report);
    acc[pathway] ??= [];
    acc[pathway].push(insight);
    return acc;
  }, {});

  return Object.entries(grouped).map(([pathway, insights]) => ({
    pathway,
    categories: Array.from(new Set(insights.map((insight) => insight.category))),
    genes: Array.from(new Set(insights.flatMap((insight) => extractGenes(report, insight)))),
    highlights: insights
      .slice()
      .sort((left, right) => scoreInsightPriority(right) - scoreInsightPriority(left))
      .slice(0, 3)
      .map((insight) => insight.title),
  })).sort((left, right) => left.pathway.localeCompare(right.pathway));
}

export function exportDnaInsightsMarkdown(report: DnaReport) {
  const protocol = buildActionableProtocol(report);
  const topInsights = getPriorityFindings(report);
  const diseaseRisks = summarizeDiseaseRisks(report);
  const pharmacogenomics = summarizePharmacogenomics(report);
  const pathways = summarizeGeneticPathways(report);

  const variantRows = report.variants
    .slice(0, 20)
    .map((variant) => {
      const annotation = annotationMap.get(variant.rsId.toLowerCase());
      return `| ${variant.rsId} | ${annotation?.gene ?? "Unknown"} | ${variant.genotype} | ${annotation?.category ?? "other"} | ${annotation?.impact ?? "neutral"} |`;
    })
    .join("\n");

  return [
    `# Genetic Health Summary — ${report.fileName ?? report.id}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${report.source}`,
    `Privacy mode: ${report.privacyMode ?? "living"}`,
    "",
    "## Executive Summary",
    `- Imported SNPs: ${report.rawSnpsImported}`,
    `- Knowledge-base matches: ${report.snpsMatchedToKnowledgeBase}`,
    `- Actionable insights: ${report.healthInsights.length}`,
    report.ancestryComposition ? `- Inferred ancestry signal: ${report.ancestryComposition.overall}` : "- Inferred ancestry signal: not enough markers to infer confidently",
    "",
    "## Evidence Ladder",
    "- Tier 1: Practice guideline",
    "- Tier 2: Curated clinical evidence",
    "- Tier 3: Replicated research",
    "- Tier 4: Preliminary research",
    "",
    "## Top Actionable Insights",
    ...topInsights.map((insight) => `- **${insight.title}** (${insight.evidenceLabel ?? "Research signal"}) — ${insight.actionableRecommendation ?? "Review this signal in context with symptoms, history, and confirmatory testing."}`),
    "",
    "## Disease Risk Watchlist",
    ...(diseaseRisks.length
      ? diseaseRisks.map((risk) => `- **${risk.domain} (${risk.level})** — ${risk.rationale}. Monitor: ${risk.monitoringSuggestions.join("; ") || "repeat labs / symptom tracking as appropriate"}`)
      : ["- No risk-domain summaries surfaced from the curated report."]),
    "",
    "## Pharmacogenomic Watch-outs",
    ...(pharmacogenomics.length
      ? pharmacogenomics.slice(0, 8).map((item) => `- **${item.gene}** — ${item.summary} Relevant meds: ${item.medications.join(", ")}.`)
      : ["- No pharmacogenomic watch-outs surfaced in the current curated set."]),
    "",
    "## Pathway Map",
    ...(pathways.length
      ? pathways.map((pathway) => `- **${pathway.pathway}** — genes: ${pathway.genes.join(", ") || "n/a"}; highlights: ${pathway.highlights.join(", ")}`)
      : ["- No pathway groupings available."]),
    "",
    "## Actionable Health Protocol",
    "### Nutrition",
    ...(protocol.nutrition.length ? protocol.nutrition : ["- No nutrition-specific signals surfaced in the curated set yet."]),
    "### Training",
    ...(protocol.training.length ? protocol.training : ["- No training-specific signals surfaced in the curated set yet."]),
    "### Cardiovascular",
    ...(protocol.cardiovascular.length ? protocol.cardiovascular : ["- No cardiovascular signals surfaced in the curated set yet."]),
    "### Sleep & Recovery",
    ...(protocol.sleep.length ? protocol.sleep : ["- No sleep or circadian signals surfaced in the curated set yet."]),
    "### Pharmacogenomics",
    ...(protocol.pharmacogenomics.length ? protocol.pharmacogenomics : ["- No pharmacogenomic watch-outs surfaced in the curated set yet."]),
    "",
    "## Variant Snapshot",
    "| rsID | Gene | Genotype | Category | Impact |",
    "| --- | --- | --- | --- | --- |",
    variantRows || "| n/a | n/a | n/a | n/a | n/a |",
    "",
    "## Safety framing",
    "This export is educational and intended to support more informed conversations with a qualified clinician. It does not diagnose disease or recommend starting/stopping medication.",
  ].join("\n");
}

export function annotateVariant(report: DnaReport, rsId: string, note: string) {
  return {
    ...report,
    variants: report.variants.map((variant) => variant.rsId.toLowerCase() === rsId.toLowerCase()
      ? {
        ...variant,
        annotations: {
          ...(variant.annotations ?? {}),
          personalNote: note,
        },
      }
      : variant),
  };
}

export function foodProtocolHint(insights: DnaHealthInsight[]) {
  return insights
    .filter((insight) => insight.category === "nutrition" || insight.category === "metabolic")
    .slice(0, 3)
    .map((insight) => insight.actionableRecommendation ?? insight.description);
}

export function summarizeReport(report: DnaReport) {
  const impactful = report.healthInsights.filter((insight) => insight.impact !== "neutral");
  const positiveCount = impactful.filter((insight) => insight.impact === "positive").length;
  const watchCount = impactful.filter((insight) => insight.impact === "risk").length;

  return {
    reportId: report.id,
    summary: `${watchCount} watch-outs and ${positiveCount} favorable signals across ${report.healthInsights.length} curated insights`,
    topInsights: getPriorityFindings(report).slice(0, 5),
    diseaseRisks: summarizeDiseaseRisks(report),
    pharmacogenomics: summarizePharmacogenomics(report).slice(0, 5),
    pathways: summarizeGeneticPathways(report),
    protocol: buildActionableProtocol(report),
  };
}

const FOOD_CATALOGUE = [
  { id: "food-greek-yogurt", name: "Greek yogurt", calories: 140, proteinGrams: 16, carbGrams: 6, fatGrams: 4, source: "Curated" },
  { id: "food-salmon", name: "Salmon fillet", calories: 280, proteinGrams: 34, carbGrams: 0, fatGrams: 16, source: "Curated" },
  { id: "food-oats", name: "Rolled oats", calories: 190, proteinGrams: 7, carbGrams: 32, fatGrams: 4, fiberGrams: 5, source: "Curated" },
  { id: "food-eggs", name: "Eggs", calories: 140, proteinGrams: 12, carbGrams: 1, fatGrams: 10, source: "Curated" },
  { id: "food-blueberries", name: "Blueberries", calories: 84, proteinGrams: 1, carbGrams: 21, fatGrams: 0, fiberGrams: 4, source: "Curated" },
  { id: "food-protein-shake", name: "Protein shake", calories: 160, proteinGrams: 30, carbGrams: 4, fatGrams: 3, source: "Curated" },
] as const;

export function findFoodMatches(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  return FOOD_CATALOGUE.filter((item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase() === q);
}

export function getFoodDetail(id: string) {
  const normalized = id.trim().toLowerCase();
  return FOOD_CATALOGUE.find((item) => item.id.toLowerCase() === normalized) ?? null;
}

export function findAlleleEffect(annotation: DnaVariantAnnotation | undefined, genotype: string): AlleleEffect | undefined {
  return annotation?.alleleEffects?.find((entry) => normalizeAlleleKey(entry.allele) === genotype)
    ?? annotation?.alleleEffects?.find((entry) => genotype.includes(normalizeAlleleKey(entry.allele)));
}
