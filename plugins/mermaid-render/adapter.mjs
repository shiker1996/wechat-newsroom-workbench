import { executeChartScript, chartHealth } from '../shared/chart-adapter.mjs';
export const execute = (input, context) => executeChartScript('mermaid', input, context);
export const health = () => chartHealth('mermaid');
