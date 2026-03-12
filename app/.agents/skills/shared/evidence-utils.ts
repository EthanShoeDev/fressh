/**
 * Evidence Display Utilities
 *
 * Reusable types and functions for rendering traceable, explainable metrics.
 * See: evidence-display-spec.md for full specification.
 */

// ============================================================================
// Source Types
// ============================================================================

export type SourceType =
  | "benchmark" // 📊 External research with URL
  | "crm" // 📁 CRM/context data
  | "calculated" // 🔢 Derived from calculation
  | "config" // ⚙️ Configuration/best practice
  | "assumption"; // 💡 Reasonable assumption

export const SOURCE_ICONS: Record<SourceType, string> = {
  benchmark: "📊",
  crm: "📁",
  calculated: "🔢",
  config: "⚙️",
  assumption: "💡",
};

export const SOURCE_COLORS: Record<SourceType, { bg: string; text: string }> = {
  benchmark: { bg: "rgba(124, 58, 237, 0.12)", text: "#7c3aed" },
  crm: { bg: "rgba(2, 132, 199, 0.12)", text: "#0284c7" },
  calculated: { bg: "rgba(5, 150, 105, 0.12)", text: "#059669" },
  config: { bg: "rgba(217, 119, 6, 0.12)", text: "#d97706" },
  assumption: { bg: "rgba(147, 51, 234, 0.12)", text: "#9333ea" },
};

// ============================================================================
// Core Types
// ============================================================================

/**
 * Reference to another calculation step, metric, or claim for cross-navigation
 */
export interface CalculationReference {
  type: "step" | "metric" | "claim";
  id: string; // step_number (as string), metric_id, or claim_id
}

export interface CalculationInput {
  name: string;
  value: number | string;
  source: string;
  source_type: SourceType;
  source_url?: string;
  source_citation?: string;
  /** Cross-reference for navigation (e.g., link to another step or claim) */
  reference?: CalculationReference;
}

export interface CalculationStep {
  step_number: number;
  description: string;
  /** Human-readable formula (existing) */
  formula: string;
  /**
   * Tokenized formula template for rendering with actual values.
   * Use {variable_name} placeholders that match input names.
   * Example: "{ae_count}×{ae_ote}+{sdr_count}×{sdr_ote}+{am_count}×{am_ote}"
   */
  formula_template?: string;
  inputs: CalculationInput[];
  output: { name: string; value: number | string };
}

export interface SourceMeta {
  title: string;
  publisher: string;
  year: number;
  quote: string;
  url?: string;
}

export interface MetricLineage {
  metric_id: string;
  display_name: string;
  raw_value: number;
  formatted_value: string;
  unit: "currency" | "percentage" | "count" | "ratio";
  definition: string;
  source: SourceType | "crm" | "calculated" | "benchmark" | "assumption";
  source_detail: string;
  confidence: "high" | "medium" | "low";
  calculation_chain?: CalculationStep[];
  citation_id?: string;
  source_meta?: SourceMeta;
}

// ============================================================================
// Formatting Utilities
// ============================================================================

export function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  } else if (Math.abs(value) >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatValue(
  value: number,
  unit: MetricLineage["unit"]
): string {
  switch (unit) {
    case "currency":
      return formatCurrency(value);
    case "percentage":
      return formatPercentage(value);
    case "count":
      return value.toLocaleString();
    case "ratio":
      return `${value.toFixed(1)}x`;
    default:
      return String(value);
  }
}

// ============================================================================
// Metric Building
// ============================================================================

export interface BuildMetricParams {
  metric_id: string;
  display_name: string;
  raw_value: number;
  unit: MetricLineage["unit"];
  definition: string;
  source: MetricLineage["source"];
  source_detail: string;
  confidence: MetricLineage["confidence"];
  calculation_chain?: CalculationStep[];
  citation_id?: string;
  source_meta?: SourceMeta;
}

export function buildMetricLineage(params: BuildMetricParams): MetricLineage {
  return {
    metric_id: params.metric_id,
    display_name: params.display_name,
    raw_value: params.raw_value,
    formatted_value: formatValue(params.raw_value, params.unit),
    unit: params.unit,
    definition: params.definition,
    source: params.source,
    source_detail: params.source_detail,
    confidence: params.confidence,
    calculation_chain: params.calculation_chain,
    citation_id: params.citation_id,
    source_meta: params.source_meta,
  };
}

// ============================================================================
// Key Inputs Extraction
// ============================================================================

/**
 * Extract source inputs from a calculation chain (not intermediate values)
 */
export function extractKeyInputs(
  calculationChain: CalculationStep[]
): CalculationInput[] {
  const keyInputs: CalculationInput[] = [];

  calculationChain.forEach((step) => {
    step.inputs.forEach((inp) => {
      // Skip inputs that reference other steps (they're intermediate)
      const isIntermediate =
        inp.source.includes("Step ") || inp.source.includes("output");
      if (!isIntermediate) {
        keyInputs.push(inp);
      }
    });
  });

  return keyInputs;
}

// ============================================================================
// HTML Rendering Helpers
// ============================================================================

export function getSourceIcon(sourceType: SourceType | string): string {
  return SOURCE_ICONS[sourceType as SourceType] || "📋";
}

export function getSourceColorClass(sourceType: SourceType | string): string {
  return sourceType || "default";
}

/**
 * Render a value pill with appropriate styling
 */
export function renderValuePillHtml(
  value: string | number,
  sourceType: SourceType,
  source: string,
  sourceUrl?: string
): string {
  const icon = getSourceIcon(sourceType);
  const colorClass = getSourceColorClass(sourceType);

  if (sourceType === "benchmark" && sourceUrl) {
    return `
      <a href="${sourceUrl}" target="_blank" class="value-pill ${colorClass}" title="${source}">
        <span class="pill-icon">${icon}</span>
        <span class="pill-value">${value}</span>
        <span class="pill-link">↗</span>
      </a>
    `;
  } else {
    return `
      <span class="value-pill ${colorClass}" title="${source}">
        <span class="pill-icon">${icon}</span>
        <span class="pill-value">${value}</span>
      </span>
    `;
  }
}

/**
 * Render Key Inputs list HTML
 */
export function renderKeyInputsHtml(
  inputs: CalculationInput[],
  resultValue: string
): string {
  const inputRows = inputs
    .map((inp) => {
      const icon = getSourceIcon(inp.source_type);
      const colorClass = getSourceColorClass(inp.source_type);

      const sourceHtml =
        inp.source_type === "benchmark" && inp.source_url
          ? `<a href="${inp.source_url}" target="_blank" class="source-link">${inp.source} ↗</a>`
          : `<span class="source-text">${inp.source}</span>`;

      return `
        <div class="key-input-row">
          <span class="input-name">${inp.name}:</span>
          <span class="input-value ${colorClass}">${icon} ${inp.value}</span>
          ${sourceHtml}
        </div>
      `;
    })
    .join("");

  return `
    <div class="key-inputs">
      <div class="key-inputs-label">Key Inputs:</div>
      <div class="key-inputs-list">${inputRows}</div>
      <div class="key-inputs-result">
        <span class="result-label">Result:</span>
        <span class="result-value">${resultValue}</span>
      </div>
    </div>
  `;
}

/**
 * Generate CSS for evidence display components
 */
export function getEvidenceDisplayCss(): string {
  return `
    /* Value Pills */
    .value-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s;
    }

    .value-pill.benchmark { background: ${SOURCE_COLORS.benchmark.bg}; color: ${SOURCE_COLORS.benchmark.text}; }
    .value-pill.crm { background: ${SOURCE_COLORS.crm.bg}; color: ${SOURCE_COLORS.crm.text}; }
    .value-pill.calculated { background: ${SOURCE_COLORS.calculated.bg}; color: ${SOURCE_COLORS.calculated.text}; }
    .value-pill.config { background: ${SOURCE_COLORS.config.bg}; color: ${SOURCE_COLORS.config.text}; }
    .value-pill.assumption { background: ${SOURCE_COLORS.assumption.bg}; color: ${SOURCE_COLORS.assumption.text}; }

    a.value-pill:hover { transform: scale(1.05); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }

    /* Key Inputs */
    .key-inputs {
      background: linear-gradient(135deg, #f8fafc, #f1f5f9);
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1rem;
    }

    .key-inputs-label {
      font-size: 0.7rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
      font-weight: 600;
    }

    .key-input-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .input-name { font-size: 0.8rem; color: #475569; min-width: 100px; }
    .input-value { font-size: 0.85rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 5px; }

    .source-link {
      font-size: 0.75rem;
      color: #7c3aed;
      text-decoration: none;
      padding: 0.15rem 0.4rem;
      background: rgba(124, 58, 237, 0.08);
      border-radius: 4px;
    }
    .source-link:hover { background: rgba(124, 58, 237, 0.15); }

    .source-text { font-size: 0.75rem; color: #94a3b8; font-style: italic; }

    .key-inputs-result {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 2px solid #e2e8f0;
    }

    .result-label { font-size: 0.8rem; color: #475569; font-weight: 600; }
    .result-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: #059669;
      background: rgba(5, 150, 105, 0.1);
      padding: 0.3rem 0.6rem;
      border-radius: 6px;
    }
  `;
}
