import { executeChartScript, chartHealth } from '../shared/chart-adapter.mjs';
export const execute = (input, context) => executeChartScript('echarts', input, context);
export const health = () => chartHealth('echarts');
