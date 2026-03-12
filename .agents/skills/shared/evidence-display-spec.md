# Evidence Display Specification

A standard for displaying traceable, explainable metrics across all skills and reports.

## Core Principle

**Every number must be traceable to its source.** Users should be able to understand:
1. What the value is
2. Where it came from
3. How it was calculated (if derived)

---

## Source Types

Every value has a source type that determines how it's displayed:

| Type | Icon | Color | Behavior |
|------|------|-------|----------|
| `benchmark` | 📊 | Purple (#7c3aed) | Clickable link to source URL |
| `crm` | 📁 | Blue (#0284c7) | Shows CRM field/query reference |
| `calculated` | 🔢 | Green (#059669) | Expandable to show calculation |
| `config` | ⚙️ | Orange (#d97706) | Shows configuration rationale |
| `assumption` | 💡 | Purple (#9333ea) | Shows reasoning for assumption |

---

## Data Structure

### MetricLineage

Every metric should include full lineage:

```typescript
interface MetricLineage {
  metric_id: string;
  display_name: string;
  raw_value: number;
  formatted_value: string;
  unit: "currency" | "percentage" | "count" | "ratio";
  definition: string;
  source: SourceType;
  source_detail: string;
  confidence: "high" | "medium" | "low";

  // For calculated metrics
  calculation_chain?: CalculationStep[];

  // For benchmark metrics
  citation_id?: string;
  source_meta?: {
    title: string;
    publisher: string;
    year: number;
    quote: string;
    url?: string;
  };
}
```

### CalculationInput

Every input to a calculation:

```typescript
interface CalculationInput {
  name: string;
  value: number | string;
  source: string;           // Human-readable description
  source_type: SourceType;
  source_url?: string;      // For benchmarks
  source_citation?: string; // Citation reference
}
```

### CalculationStep

A step in a multi-step calculation:

```typescript
interface CalculationStep {
  step_number: number;
  description: string;
  formula: string;
  inputs: CalculationInput[];
  output: { name: string; value: number | string };
}
```

---

## Display Patterns

### Pattern 1: Key Inputs List (Primary)

Use this as the **default display** for any calculated metric.

**Structure:**
```
┌─────────────────────────────────────────────────┐
│ KEY INPUTS:                                     │
├─────────────────────────────────────────────────┤
│ input_name:  📊 $190K   Source Name ↗          │
│ input_name:  📁 6       CRM description         │
│ input_name:  ⚙️ 45%     Config rationale        │
├─────────────────────────────────────────────────┤
│ Result:      $921K                              │
└─────────────────────────────────────────────────┘
```

**Rules:**
1. List all **source inputs** (not intermediate values)
2. Each row shows: name, colored value with icon, source description
3. Benchmark sources are clickable links (↗)
4. Result is prominently displayed at bottom
5. Skip inputs that reference other calculation steps (they're intermediate)

### Pattern 2: Formula Line (Optional)

For users who want to see the math at a glance:

```
(6 × $190K + 3 × $90K + 3 × $150K) × 45% × 1.10 = $921K
```

**Rules:**
1. Show in a monospace/code font
2. Use actual values, not variable names
3. Keep on one line if possible
4. Use standard math operators (×, +, -, ÷)

### Pattern 3: Full Calculation Steps (Expandable)

For auditing and debugging. **Always collapsed by default.**

**Structure:**
```
▶ Show Full Calculation

  Step 1: Calculate Team OTE
  ├── ae_count: 6 (CRM)
  ├── ae_ote: $190K (Bridge Group 2024 ↗)
  ├── Formula: team_ote = ae × $190K + sdr × $90K + am × $150K
  └── → $1.9M

  Step 2: Extract variable portion
  ├── team_ote: $1.9M (Step 1)
  ├── variable_pct: 45% (Config)
  ├── Formula: base_variable = team_ote × 45%
  └── → $837K
```

**Rules:**
1. Each step shows description, inputs, formula, output
2. Inputs from previous steps are marked "(Step N)"
3. Calculated values can be expanded to show their step
4. Benchmark inputs link to source

---

## Rendering Guidelines

### Value Pills

Values are displayed as colored pills:

```css
.value-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  font-weight: 600;
}

.value-pill.benchmark { background: rgba(124, 58, 237, 0.12); color: #7c3aed; }
.value-pill.crm       { background: rgba(2, 132, 199, 0.12); color: #0284c7; }
.value-pill.calculated { background: rgba(5, 150, 105, 0.12); color: #059669; }
.value-pill.config    { background: rgba(217, 119, 6, 0.12); color: #d97706; }
```

### Source Links

Benchmark sources must be clickable:

```html
<a href="{source_url}" target="_blank" class="source-link">
  {source_name} ↗
</a>
```

### Interactivity

| Source Type | Click Behavior |
|-------------|----------------|
| benchmark | Opens source URL in new tab |
| calculated | Expands to show calculation step |
| crm | Shows tooltip with CRM field details |
| config | Shows tooltip with rationale |

---

## Best Practices

### DO:
- Always include source_type for every input
- Always include source_url for benchmark values
- Use human-readable source descriptions
- Format values appropriately (currency, percentage, etc.)
- Keep Key Inputs list concise (source values only)

### DON'T:
- Show intermediate calculated values in Key Inputs
- Use technical variable names in formulas (use values)
- Make Full Calculation expanded by default
- Forget to include source links for benchmarks

---

## Implementation Checklist

When implementing evidence display for a new metric:

- [ ] Define MetricLineage with all required fields
- [ ] Set source_type for each input
- [ ] Add source_url for all benchmark inputs
- [ ] Build calculation_chain with all steps
- [ ] Filter Key Inputs to show only source values
- [ ] Implement color-coded value pills
- [ ] Make benchmark sources clickable
- [ ] Add expandable Full Calculation (collapsed by default)
- [ ] Test that every number is traceable to its origin

---

## Example Usage

```typescript
import { buildMetricLineage, CalculationStep } from './evidence-utils';

const calculationChain: CalculationStep[] = [
  {
    step_number: 1,
    description: "Calculate Team OTE from role benchmarks",
    formula: "team_ote = (AE × $190K) + (SDR × $90K) + (AM × $150K)",
    inputs: [
      { name: "ae_count", value: 6, source: "CRM headcount", source_type: "crm" },
      { name: "ae_ote", value: "$190K", source: "Bridge Group 2024", source_type: "benchmark",
        source_url: "https://blog.bridgegroupinc.com/2024-ae-metrics-compensation-benchmark" },
      // ... more inputs
    ],
    output: { name: "team_ote", value: "$1.9M" }
  },
  // ... more steps
];

const metric = buildMetricLineage({
  metric_id: "optimal_commission",
  display_name: "Optimal Commission Spend",
  raw_value: 921000,
  unit: "currency",
  source: "calculated",
  calculation_chain: calculationChain,
});
```

---

## Version History

- **v1.0** (2025-01-24): Initial specification based on CDA Demo Wizard patterns
