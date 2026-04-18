import { createHash } from "node:crypto";
import annotationFile from "./dna/annotations.json";
import { evaluateBloodworkBiomarkers } from "./bloodwork.js";
import type {
  AlleleEffect,
  DnaCarrierFinding,
  DnaBloodworkCorrelation,
  DnaConfidence,
  DnaDiploidType,
  DnaDiseaseRisk,
  DnaEvidenceTier,
  DnaHealthInsight,
  DnaInsightCategory,
  DnaPathwaySummary,
  DnaPharmacogenomicInteraction,
  DnaPriorityFinding,
  DnaProtectiveFinding,
  DnaReport,
  DnaSource,
  DnaSupplementRecommendation,
  DnaTraitSummary,
  DnaMonitoringItem,
  DnaVariant,
  DnaVariantAnnotation,
  LabResult,
} from "./types.js";
import { generateId, round } from "./utils.js";

interface AnnotationBundle {
  variants: DnaVariantAnnotation[];
}

const annotations = (annotationFile as AnnotationBundle).variants;
const annotationMap = new Map(annotations.map((annotation) => [annotation.rsId.toLowerCase(), annotation]));
export const DNA_KNOWLEDGE_BASE_VERSION = `curated-${annotations.length}-variants`;

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

function canonicalizeGenotype(value: string): string {
  return normalizeAlleleKey(value).split("").sort().join("");
}

function extractAllelePatterns(value: string): string[] {
  const matches = value.toUpperCase().match(/\b[ACGTDI]{1,2}(?:\/[ACGTDI]{1,2})*\b/g) ?? [];
  const patterns = matches.flatMap((match) => match.split("/").map((part) => canonicalizeGenotype(part)));
  if (patterns.length) {
    return Array.from(new Set(patterns.filter(Boolean)));
  }
  const fallback = canonicalizeGenotype(value);
  return fallback ? [fallback] : [];
}

function matchAlleleEffect(annotation: DnaVariantAnnotation, genotype: string): AlleleEffect | undefined {
  const canonicalGenotype = canonicalizeGenotype(genotype);
  return annotation.alleleEffects?.find((effect) => extractAllelePatterns(effect.allele).includes(canonicalGenotype));
}

function inferEvidenceTier(annotation: DnaVariantAnnotation): DnaEvidenceTier {
  if (annotation.evidenceTier) {
    return annotation.evidenceTier;
  }
  if (annotation.category === "pharmacogenomics") {
    return 1;
  }
  if (annotation.category === "cardiovascular" || annotation.category === "risk") {
    return 2;
  }
  if (
    annotation.category === "nutrition"
    || annotation.category === "fitness"
    || annotation.category === "metabolic"
    || annotation.category === "sleep"
    || annotation.category === "inflammation"
    || annotation.category === "autoimmune"
    || annotation.category === "hormonal"
  ) {
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
  const matched = matchAlleleEffect(annotation, genotype);
  if (matched) {
    return matched.summary;
  }
  return undefined;
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
  const matchedEffect = matchAlleleEffect(annotation, variant.genotype);
  return {
    id: generateId(),
    category: annotation.category,
    title: annotation.title,
    description: `${annotation.description} Your observed genotype is ${variant.genotype}.`,
    impact: matchedEffect?.impact ?? annotation.impact,
    relevantVariants: [variant.rsId],
    actionableRecommendation: matchedEffect?.summary ?? resolveActionableRecommendation(annotation, variant.genotype),
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
  allowAncestryInference?: boolean;
  retainVariantLevelData?: boolean;
}): Omit<DnaReport, "id" | "uploadDate"> {
  const rawData = input.rawData.trim();
  const source = detectDnaSource(rawData, input.fileName);
  if (source === "other") {
    throw new Error("Unsupported DNA source. Please import a 23andMe or AncestryDNA raw text export.");
  }
  const lines = rawData.split(/\r?\n/);
  const parsed = source === "ancestrydna" ? parseAncestry(lines) : parse23AndMe(lines);
  const matchedVariants: DnaVariant[] = [];
  const insights: DnaHealthInsight[] = [];
  const parseWarnings: string[] = [];

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
    fileHash: input.privacyMode === "privacy" ? undefined : createHash("sha256").update(rawData).digest("hex"),
    ancestryComposition: input.privacyMode === "privacy" || input.allowAncestryInference === false ? undefined : inferAncestry(matchedVariants),
    healthInsights: insights,
    variants: input.privacyMode === "privacy" || input.retainVariantLevelData === false ? [] : matchedVariants,
    rawSnpsImported: parsed.length,
    snpsMatchedToKnowledgeBase: matchedVariants.length,
    knowledgeBaseVersion: DNA_KNOWLEDGE_BASE_VERSION,
    parseWarnings,
    isPrivacyRestricted: input.privacyMode === "privacy" || input.retainVariantLevelData === false,
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
  allowAncestryInference?: boolean;
  retainVariantLevelData?: boolean;
}): DnaReport {
  if (input.rawData) {
    const parsed = parseRawDnaReport({
      rawData: input.rawData,
      fileName: input.fileName,
      notes: input.notes,
      privacyMode: input.privacyMode,
      allowAncestryInference: input.allowAncestryInference,
      retainVariantLevelData: input.retainVariantLevelData,
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
    variants: input.privacyMode === "privacy" || input.retainVariantLevelData === false ? [] : (input.variants ?? []),
    rawSnpsImported: input.rawSnpsImported ?? input.variants?.length ?? 0,
    snpsMatchedToKnowledgeBase: input.snpsMatchedToKnowledgeBase ?? input.healthInsights?.length ?? 0,
    knowledgeBaseVersion: DNA_KNOWLEDGE_BASE_VERSION,
    parseWarnings: input.privacyMode === "privacy" ? ["Variant-level DNA storage has been minimized for privacy mode."] : [],
    isPrivacyRestricted: input.privacyMode === "privacy" || input.retainVariantLevelData === false,
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
    : insight.category === "cardiovascular" || insight.category === "metabolic" || insight.category === "carrier"
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
  if (insight.category === "autoimmune") {
    return "Autoimmune / Immune";
  }
  if (insight.category === "psychiatric" || insight.category === "pain") {
    return "Neuropsychiatric";
  }
  if (insight.category === "skin" || insight.category === "sensory" || insight.category === "traits") {
    return "Trait / Environmental Response";
  }
  return "General Wellness";
}

function pathwayForInsight(insight: DnaHealthInsight, report: DnaReport) {
  const genes = extractGenes(report, insight);
  const annotationPathways = insight.relevantVariants.flatMap((rsId) => annotationMap.get(rsId.toLowerCase())?.pathways ?? []);
  if (annotationPathways.length) {
    return annotationPathways[0];
  }
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
  const annotationMedications = insight.relevantVariants.flatMap((rsId) => annotationMap.get(rsId.toLowerCase())?.medications ?? []);
  if (annotationMedications.length) {
    return Array.from(new Set(annotationMedications));
  }
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

function variantMap(report: DnaReport) {
  return new Map(report.variants.map((variant) => [variant.rsId.toLowerCase(), variant]));
}

function genotypeFor(report: DnaReport, rsId: string) {
  return variantMap(report).get(rsId.toLowerCase())?.genotype;
}

function bestConfidence(confidences: Array<DnaConfidence | undefined>): DnaConfidence | undefined {
  if (confidences.includes("high")) {
    return "high";
  }
  if (confidences.includes("medium")) {
    return "medium";
  }
  if (confidences.includes("low")) {
    return "low";
  }
  return undefined;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function annotationForInsight(insight: DnaHealthInsight) {
  return insight.relevantVariants
    .map((rsId) => annotationMap.get(rsId.toLowerCase()))
    .filter((annotation): annotation is DnaVariantAnnotation => Boolean(annotation));
}

function buildDerivedTraitSummaries(report: DnaReport): DnaTraitSummary[] {
  const traits: DnaTraitSummary[] = [];
  const bloodTypeDeletion = genotypeFor(report, "rs8176719");
  const aboTransferase = genotypeFor(report, "rs8176746");
  if (bloodTypeDeletion && aboTransferase) {
    let summary = "Likely blood type is not yet inferable from the currently imported ABO markers.";
    if (bloodTypeDeletion.includes("D") && aboTransferase === "GG") {
      summary = "Likely blood type A with one O deletion carrier pattern.";
    } else if (bloodTypeDeletion.includes("I") && !bloodTypeDeletion.includes("D")) {
      summary = "Likely blood type O / non-secretor leaning ABO pattern.";
    }
    traits.push({
      key: "blood-type",
      title: "Likely Blood Type",
      summary,
      category: "bloodtype",
      confidence: "medium",
      relevantVariants: ["rs8176719", "rs8176746"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  const cyp1a2 = genotypeFor(report, "rs762551");
  const adora2a = genotypeFor(report, "rs2298383");
  if (cyp1a2 || adora2a) {
    const slow = cyp1a2 === "CC";
    const anxious = adora2a === "TT";
    const summary = slow && anxious
      ? "Genetics suggest slow caffeine clearance plus higher anxiety sensitivity; morning-only caffeine is the safer default."
      : slow
        ? "Genetics suggest slower caffeine clearance; later-day caffeine is more likely to disrupt sleep."
        : anxious
          ? "Genetics suggest heightened caffeine sensitivity even if clearance is not unusually slow."
          : "Caffeine handling looks relatively average from the imported markers.";
    traits.push({
      key: "caffeine-response",
      title: "Caffeine Response",
      summary,
      category: "sleep",
      confidence: "medium",
      relevantVariants: ["rs762551", "rs2298383"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  const bitterTaste = [genotypeFor(report, "rs713598"), genotypeFor(report, "rs1726866"), genotypeFor(report, "rs10246939")];
  if (bitterTaste.some(Boolean)) {
    const heterozygousCount = bitterTaste.filter((genotype) => genotype && genotype[0] !== genotype[1]).length;
    traits.push({
      key: "taste-profile",
      title: "Taste / Bitter Sensitivity",
      summary: heterozygousCount >= 2
        ? "Taste genetics point toward a medium taster profile with moderate bitter sensitivity."
        : "Taste genetics look closer to one end of the bitter-sensitivity spectrum, but more markers would refine the call.",
      category: "sensory",
      confidence: "medium",
      relevantVariants: ["rs713598", "rs1726866", "rs10246939"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  const prdm16 = genotypeFor(report, "rs2651899");
  if (prdm16) {
    traits.push({
      key: "migraine-risk",
      title: "Migraine / Pain Sensitivity",
      summary: prdm16 === "TT"
        ? "Imported markers suggest elevated migraine susceptibility; hydration, sleep regularity, and trigger tracking are especially worthwhile."
        : "No standout migraine-susceptibility call surfaced from the currently imported markers.",
      category: "pain",
      confidence: "medium",
      relevantVariants: ["rs2651899"],
    });
  }

  const telomereMarkers = ["rs2736100", "rs10936599", "rs7726159"].filter((rsId) => Boolean(genotypeFor(report, rsId)));
  if (telomereMarkers.length) {
    traits.push({
      key: "telomere-profile",
      title: "Telomere / Longevity Profile",
      summary: "Imported longevity markers suggest an average-to-mixed telomere maintenance profile rather than an extreme outlier pattern.",
      category: "longevity",
      confidence: "low",
      relevantVariants: telomereMarkers,
    });
  }

  const actn3 = genotypeFor(report, "rs1815739") ?? genotypeFor(report, "rs4994");
  if (actn3) {
    traits.push({
      key: "training-style",
      title: "Training Response",
      summary: actn3 === "CT" || actn3 === "GA"
        ? "Mixed ACTN3 profile suggests good responsiveness to both power and endurance work."
        : "Training-response genetics are present, but the imported markers do not force a single dominant training identity.",
      category: "fitness",
      confidence: "medium",
      relevantVariants: ["rs1815739", "rs4994"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  const comt = genotypeFor(report, "rs4683");
  const cacna1c = genotypeFor(report, "rs1006737");
  if (comt || cacna1c) {
    traits.push({
      key: "dopamine-mood",
      title: "Stress / Neurotransmitter Style",
      summary: cacna1c === "AA"
        ? "Neurotransmitter markers point to higher mood reactivity sensitivity; sleep, alcohol moderation, and stable routines likely matter more."
        : comt === "AA"
          ? "COMT suggests slower catecholamine clearance with higher sensitivity to stress and stimulants."
          : "Neurotransmitter markers look mixed-to-balanced rather than strongly polarized.",
      category: "psychiatric",
      confidence: "medium",
      relevantVariants: ["rs4683", "rs1006737"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  const mc1r = genotypeFor(report, "rs1805007");
  const herc2 = genotypeFor(report, "rs12913832");
  if (mc1r || herc2) {
    traits.push({
      key: "pigmentation-sun",
      title: "Pigmentation / Sun Sensitivity",
      summary: "Pigmentation markers support treating UV protection as a meaningful long-term skin-health lever, especially if personal phenotype matches lighter-pigment tendencies.",
      category: "skin",
      confidence: "low",
      relevantVariants: ["rs1805007", "rs12913832"].filter((rsId) => Boolean(genotypeFor(report, rsId))),
    });
  }

  return traits;
}

export function summarizeTraits(report: DnaReport): DnaTraitSummary[] {
  const annotationTraits = report.healthInsights
    .filter((insight) => {
      const annotations = annotationForInsight(insight);
      return annotations.some((annotation) => annotation.reportGroup === "trait" || annotation.traitSummary || annotation.category === "sensory" || annotation.category === "bloodtype" || annotation.category === "skin" || annotation.category === "psychiatric" || annotation.category === "longevity" || annotation.category === "pain" || annotation.category === "traits" || annotation.category === "cognition");
    })
    .map((insight) => {
      const annotations = annotationForInsight(insight);
      const lead = annotations[0];
      return {
        key: lead?.traitLabel?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? insight.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: lead?.traitLabel ?? insight.title,
        summary: lead?.traitSummary ?? insight.actionableRecommendation ?? insight.description,
        category: lead?.category ?? insight.category,
        confidence: bestConfidence(annotations.map((annotation) => annotation.confidence)),
        relevantVariants: insight.relevantVariants,
      } satisfies DnaTraitSummary;
    });

  const merged = [...annotationTraits, ...buildDerivedTraitSummaries(report)];
  const byKey = new Map<string, DnaTraitSummary>();
  for (const trait of merged) {
    if (!byKey.has(trait.key)) {
      byKey.set(trait.key, trait);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function getCarrierStatus(report: DnaReport): DnaCarrierFinding[] {
  return report.healthInsights
    .filter((insight) => annotationForInsight(insight).some((annotation) => annotation.reportGroup === "carrier" || annotation.category === "carrier"))
    .map((insight) => {
      const annotations = annotationForInsight(insight);
      const lead = annotations[0];
      return {
        gene: lead?.gene ?? extractGenes(report, insight)[0] ?? "Unknown",
        title: lead?.title ?? insight.title,
        summary: lead?.traitSummary ?? insight.description,
        confidence: bestConfidence(annotations.map((annotation) => annotation.confidence)),
        relatedConditions: unique(annotations.flatMap((annotation) => annotation.relatedConditions ?? [])),
        followUp: unique(annotations.flatMap((annotation) => annotation.monitoring ?? [])),
        relevantVariants: insight.relevantVariants,
      } satisfies DnaCarrierFinding;
    })
    .sort((left, right) => left.gene.localeCompare(right.gene));
}

export function getProtectiveVariants(report: DnaReport): DnaProtectiveFinding[] {
  return report.healthInsights
    .filter((insight) => {
      const annotations = annotationForInsight(insight);
      return insight.impact === "positive" || annotations.some((annotation) => annotation.reportGroup === "protective" || annotation.category === "protective");
    })
    .map((insight) => ({
      gene: extractGenes(report, insight)[0] ?? "Unknown",
      title: insight.title,
      summary: insight.actionableRecommendation ?? insight.description,
      relevantVariants: insight.relevantVariants,
    }))
    .sort((left, right) => left.gene.localeCompare(right.gene));
}

export function getMonitoringPlan(report: DnaReport): DnaMonitoringItem[] {
  const diseaseRisks = summarizeDiseaseRisks(report);
  const byFocus = new Map<string, DnaMonitoringItem>();

  for (const risk of diseaseRisks) {
    const item: DnaMonitoringItem = {
      focus: risk.domain,
      reason: risk.rationale,
      cadence: risk.level === "high" ? "Discuss regular follow-up with a clinician" : "Revisit during annual preventive review",
      relatedCategories: unique(report.healthInsights.filter((insight) => risk.supportingInsights.includes(insight.title)).map((insight) => insight.category)),
      relevantVariants: unique(report.healthInsights.filter((insight) => risk.supportingInsights.includes(insight.title)).flatMap((insight) => insight.relevantVariants)),
    };
    byFocus.set(item.focus, item);
  }

  for (const insight of report.healthInsights) {
    const annotations = annotationForInsight(insight);
    const monitoring = unique(annotations.flatMap((annotation) => annotation.monitoring ?? []));
    if (!monitoring.length) {
      continue;
    }
    const focus = annotations[0]?.traitLabel ?? insight.title;
    if (!byFocus.has(focus)) {
      byFocus.set(focus, {
        focus,
        reason: insight.actionableRecommendation ?? insight.description,
        relatedCategories: [insight.category],
        relevantVariants: insight.relevantVariants,
      });
    }
  }

  return Array.from(byFocus.values()).sort((left, right) => left.focus.localeCompare(right.focus));
}

export function getSupplementRecommendations(report: DnaReport): DnaSupplementRecommendation[] {
  const recommendations = report.healthInsights.flatMap((insight) => {
    const annotations = annotationForInsight(insight);
    return annotations.flatMap((annotation) => (annotation.supplementRecommendations ?? []).map((recommendation) => ({
      supplement: recommendation.supplement,
      dose: recommendation.dose,
      rationale: recommendation.rationale,
      evidenceLabel: insight.evidenceLabel,
      relevantVariants: insight.relevantVariants,
    } satisfies DnaSupplementRecommendation)));
  });

  const bySupplement = new Map<string, DnaSupplementRecommendation>();
  for (const recommendation of recommendations) {
    const key = recommendation.supplement.toLowerCase();
    if (!bySupplement.has(key)) {
      bySupplement.set(key, recommendation);
    }
  }
  return Array.from(bySupplement.values()).sort((left, right) => left.supplement.localeCompare(right.supplement));
}

export function exportComprehensiveDnaMarkdown(
  report: DnaReport,
  options?: { includeSensitive?: boolean },
) {
  const topInsights = getPriorityFindings(report);
  const diseaseRisks = summarizeDiseaseRisks(report);
  const pharmacogenomics = summarizePharmacogenomics(report);
  const pathways = summarizeGeneticPathways(report);
  const traits = summarizeTraits(report);
  const carrierStatus = getCarrierStatus(report);
  const protective = getProtectiveVariants(report);
  const monitoring = getMonitoringPlan(report);
  const supplements = getSupplementRecommendations(report);
  const includeSensitive = options?.includeSensitive === true && !report.isPrivacyRestricted;

  return [
    `# Comprehensive Genetics Report — ${report.fileName ?? report.id}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Imported SNPs: ${report.rawSnpsImported}`,
    `Matched curated variants: ${report.snpsMatchedToKnowledgeBase}`,
    `Knowledge base version: ${report.knowledgeBaseVersion ?? DNA_KNOWLEDGE_BASE_VERSION}`,
    "",
    "## Priority Findings",
    ...topInsights.map((finding) => `- **${finding.title}** (${finding.category}) — ${finding.actionableRecommendation ?? "Review with clinician if relevant."}`),
    "",
    "## Trait Summaries",
    ...(traits.length ? traits.map((trait) => `- **${trait.title}** — ${trait.summary}`) : ["- No trait summaries available from current imported markers."]),
    "",
    "## Disease Risk Domains",
    ...(diseaseRisks.length ? diseaseRisks.map((risk) => `- **${risk.domain} (${risk.level})** — ${risk.rationale}`) : ["- No disease risk domains surfaced."]),
    "",
    "## Carrier Status",
    ...(includeSensitive
      ? (carrierStatus.length ? carrierStatus.map((item) => `- **${item.gene}** — ${item.summary}`) : ["- No carrier-pattern findings surfaced in the current marker set."])
      : ["- Carrier-level details are omitted by default in privacy-safe exports."]),
    "",
    "## Protective Signals",
    ...(protective.length ? protective.map((item) => `- **${item.gene}** — ${item.summary}`) : ["- No protective signals surfaced in the current marker set."]),
    "",
    "## Drug-Gene Interactions",
    ...(pharmacogenomics.length ? pharmacogenomics.map((item) => `- **${item.gene}** — ${item.summary} Medications: ${item.medications.join(", ")}`) : ["- No pharmacogenomic interactions surfaced."]),
    "",
    "## Monitoring Plan",
    ...(monitoring.length ? monitoring.map((item) => `- **${item.focus}** — ${item.reason}`) : ["- No monitoring items generated."]),
    "",
    "## Supplement Considerations",
    ...(supplements.length ? supplements.map((item) => `- **${item.supplement}**${item.dose ? ` (${item.dose})` : ""} — ${item.rationale}`) : ["- No supplement considerations generated."]),
    "",
    "## Pathway Map",
    ...(pathways.length ? pathways.map((pathway) => `- **${pathway.pathway}** — ${pathway.highlights.join(", ")}`) : ["- No pathway map available."]),
    "",
    "## Safety framing",
    "This genetics export is educational and intended to support clinician conversations. It does not diagnose disease or replace genetic counseling, confirmatory testing, or medication review.",
    includeSensitive
      ? "Sensitive sections were included because explicit export confirmation was provided."
      : "Sensitive sections are redacted by default; require explicit confirmation before sharing the full report.",
  ].join("\n");
}

export function exportDnaInsightsMarkdown(
  report: DnaReport,
  options?: { includeSensitive?: boolean },
) {
  const protocol = buildActionableProtocol(report);
  const topInsights = getPriorityFindings(report);
  const diseaseRisks = summarizeDiseaseRisks(report);
  const pharmacogenomics = summarizePharmacogenomics(report);
  const pathways = summarizeGeneticPathways(report);
  const traits = summarizeTraits(report);
  const carrierStatus = getCarrierStatus(report);
  const protective = getProtectiveVariants(report);
  const monitoring = getMonitoringPlan(report);
  const supplements = getSupplementRecommendations(report);
  const includeSensitive = options?.includeSensitive === true && !report.isPrivacyRestricted;

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
    `Knowledge base version: ${report.knowledgeBaseVersion ?? DNA_KNOWLEDGE_BASE_VERSION}`,
    "",
    "## Executive Summary",
    `- Imported SNPs: ${report.rawSnpsImported}`,
    `- Knowledge-base matches: ${report.snpsMatchedToKnowledgeBase}`,
    `- Actionable insights: ${report.healthInsights.length}`,
    report.ancestryComposition && includeSensitive
      ? `- Inferred ancestry signal: ${report.ancestryComposition.overall}`
      : "- Inferred ancestry signal: omitted in privacy-safe mode",
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
    "## Trait Snapshots",
    ...(traits.length
      ? traits.slice(0, 8).map((trait) => `- **${trait.title}** — ${trait.summary}`)
      : ["- No trait summaries available from current imported markers."]),
    "",
    "## Carrier / Protective Notes",
    ...(includeSensitive && carrierStatus.length
      ? carrierStatus.slice(0, 4).map((item) => `- **Carrier — ${item.gene}**: ${item.summary}`)
      : []),
    ...(protective.length
      ? protective.slice(0, 4).map((item) => `- **Protective — ${item.gene}**: ${item.summary}`)
      : [includeSensitive ? "- No carrier or protective highlights surfaced in the current curated set." : "- Carrier details are redacted by default; protective highlights remain visible."]),
    "",
    "## Clinician Discussion Guide (Actionable Health Protocol)",
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
    "### Monitoring",
    ...(monitoring.length ? monitoring.slice(0, 6).map((item) => `- **${item.focus}** — ${item.reason}`) : ["- No monitoring priorities surfaced in the curated set yet."]),
    "### Supplement considerations",
    ...(supplements.length ? supplements.slice(0, 6).map((item) => `- **${item.supplement}**${item.dose ? ` (${item.dose})` : ""} — ${item.rationale}`) : ["- No supplement suggestions surfaced in the curated set yet."]),
    "",
    "## Variant Snapshot",
    "| rsID | Gene | Genotype | Category | Impact |",
    "| --- | --- | --- | --- | --- |",
    includeSensitive ? (variantRows || "| n/a | n/a | n/a | n/a | n/a |") : "| redacted | redacted | redacted | redacted | redacted |",
    "",
    "## Safety framing",
    "This export is educational and intended to support more informed conversations with a qualified clinician. It does not diagnose disease or recommend starting/stopping medication.",
    includeSensitive
      ? "Sensitive sections were included because explicit export confirmation was provided."
      : "Sensitive sections are redacted by default and should only be shared after explicit review and confirmation.",
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
    traits: summarizeTraits(report),
    carrierStatus: getCarrierStatus(report),
    protective: getProtectiveVariants(report),
    monitoringPlan: getMonitoringPlan(report),
    supplementRecommendations: getSupplementRecommendations(report),
    protocol: buildActionableProtocol(report),
  };
}

function genesInReport(report: DnaReport) {
  return new Set(report.healthInsights.flatMap((insight) => extractGenes(report, insight)));
}

export function correlateDnaWithBloodwork(report: DnaReport, result: LabResult): DnaBloodworkCorrelation[] {
  const genes = genesInReport(report);
  const evaluated = evaluateBloodworkBiomarkers(result, {});
  const byId = new Map(evaluated.map((entry) => [entry.id, entry]));
  const correlations: DnaBloodworkCorrelation[] = [];

  const ldl = byId.get("ldl-cholesterol") ?? byId.get("apolipoprotein-b");
  if ((genes.has("APOE") || genes.has("LPL") || genes.has("CETP")) && ldl) {
    correlations.push({
      id: generateId(),
      title: "Cardiometabolic genetics + lipid panel",
      priority: ldl.status === "high" ? "high" : "medium",
      genes: Array.from(genes).filter((gene) => ["APOE", "LPL", "CETP"].includes(gene)),
      biomarkers: [ldl.name],
      summary:
        ldl.status === "high"
          ? `${ldl.name} is outside the optimal zone while lipid-handling genes are also present. Use the lab trend, family history, and overall cardiovascular risk picture instead of genetics alone.`
          : `${ldl.name} is not currently flagged, but lipid-handling genes suggest keeping a close eye on long-term cardiometabolic trends.`,
      clinicianDiscussion: [
        "Review LDL / ApoB trend over time instead of a single draw.",
        "Pair genetics with blood pressure, family history, and lifestyle context.",
      ],
    });
  }

  const ferritin = byId.get("ferritin");
  if ((genes.has("HFE") || genes.has("TF")) && ferritin) {
    correlations.push({
      id: generateId(),
      title: "Iron-regulation genetics + ferritin",
      priority: ferritin.status === "high" ? "high" : "medium",
      genes: Array.from(genes).filter((gene) => ["HFE", "TF"].includes(gene)),
      biomarkers: [ferritin.name],
      summary:
        ferritin.status === "high"
          ? `${ferritin.name} is elevated while iron-handling genetics are present; discuss iron overload context with a clinician.`
          : `${ferritin.name} is not overtly elevated, but iron-handling genetics make periodic iron-status review more useful.`,
      clinicianDiscussion: [
        "Review ferritin together with iron saturation / transferrin when available.",
        "Interpret ferritin alongside inflammation context.",
      ],
    });
  }

  const vitaminD = byId.get("vitamin-d");
  if ((genes.has("VDR") || genes.has("GC") || genes.has("CYP2R1")) && vitaminD) {
    correlations.push({
      id: generateId(),
      title: "Vitamin D genetics + vitamin D biomarker",
      priority: vitaminD.status === "low" ? "high" : "medium",
      genes: Array.from(genes).filter((gene) => ["VDR", "GC", "CYP2R1"].includes(gene)),
      biomarkers: [vitaminD.name],
      summary:
        vitaminD.status === "low"
          ? `${vitaminD.name} is below the selected optimal zone and vitamin D handling genes are also present, making follow-up and retesting more actionable.`
          : `${vitaminD.name} is not currently low, but vitamin D handling genes still support seasonal retesting.`,
      clinicianDiscussion: [
        "Discuss dose, sunlight exposure, and retest timing rather than acting on one result alone.",
      ],
    });
  }

  const inflammation = byId.get("high-sensitivity-crp");
  if ((genes.has("IL6") || genes.has("TNF") || genes.has("CRP")) && inflammation) {
    correlations.push({
      id: generateId(),
      title: "Inflammation genetics + hsCRP",
      priority: inflammation.status === "high" ? "high" : "medium",
      genes: Array.from(genes).filter((gene) => ["IL6", "TNF", "CRP"].includes(gene)),
      biomarkers: [inflammation.name],
      summary:
        inflammation.status === "high"
          ? `${inflammation.name} is elevated alongside inflammatory signaling variants, so retesting after recovery and reviewing sleep/training context is worthwhile.`
          : `${inflammation.name} is not elevated now, but inflammatory variants still support tracking recovery and repeat measurements over time.`,
      clinicianDiscussion: [
        "Interpret hsCRP after ruling out acute illness or unusually heavy training.",
      ],
    });
  }

  const methylationMarkers = [byId.get("vitamin-b12"), byId.get("folate"), byId.get("mcv")].filter(Boolean);
  if ((genes.has("MTHFR") || genes.has("MTRR") || genes.has("FUT2") || genes.has("PEMT")) && methylationMarkers.length) {
    correlations.push({
      id: generateId(),
      title: "Methylation / nutrient genes + supportive labs",
      priority: methylationMarkers.some((entry) => entry?.status === "low" || entry?.status === "high") ? "high" : "medium",
      genes: Array.from(genes).filter((gene) => ["MTHFR", "MTRR", "FUT2", "PEMT"].includes(gene)),
      biomarkers: methylationMarkers.map((entry) => entry!.name),
      summary: `Nutrient-handling genes align with ${methylationMarkers.map((entry) => entry!.name).join(", ")}. Use current physiology to ground genetics interpretation rather than genetics alone.`,
      clinicianDiscussion: [
        "Pair genetics with B12 / folate / homocysteine context when available.",
        "Avoid supplement changes based on genetics alone.",
      ],
    });
  }

  return correlations;
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
  return annotation ? matchAlleleEffect(annotation, genotype) : undefined;
}
