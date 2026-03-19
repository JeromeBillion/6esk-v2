// Mock analytics data

export interface KPIMetric {
  id: string;
  label: string;
  value: number;
  unit?: string;
  change: number; // percentage change from previous period
  trend: 'up' | 'down';
  format: 'number' | 'duration' | 'percentage' | 'currency';
}

export interface TimeSeriesData {
  date: string;
  tickets: number;
  resolved: number;
  avgResponseTime: number;
  satisfaction: number;
}

export interface ChannelDistribution {
  channel: string;
  count: number;
  percentage: number;
}

export interface PriorityBreakdown {
  priority: string;
  count: number;
  avgResolutionTime: number;
}

export interface AgentPerformance {
  agent: string;
  ticketsHandled: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  satisfaction: number;
}

// KPI Metrics
export const mockKPIMetrics: KPIMetric[] = [
  {
    id: 'total-tickets',
    label: 'Total Tickets',
    value: 1847,
    change: 12.5,
    trend: 'up',
    format: 'number',
  },
  {
    id: 'avg-response-time',
    label: 'Avg Response Time',
    value: 45, // minutes
    unit: 'min',
    change: -23.4,
    trend: 'down',
    format: 'duration',
  },
  {
    id: 'resolution-rate',
    label: 'Resolution Rate',
    value: 94.2,
    unit: '%',
    change: 5.8,
    trend: 'up',
    format: 'percentage',
  },
  {
    id: 'customer-satisfaction',
    label: 'Customer Satisfaction',
    value: 4.7,
    unit: '/5',
    change: 8.3,
    trend: 'up',
    format: 'number',
  },
  {
    id: 'first-response-time',
    label: 'First Response Time',
    value: 12, // minutes
    unit: 'min',
    change: -18.2,
    trend: 'down',
    format: 'duration',
  },
  {
    id: 'avg-resolution-time',
    label: 'Avg Resolution Time',
    value: 18.5, // hours
    unit: 'hrs',
    change: -12.1,
    trend: 'down',
    format: 'duration',
  },
];

// Time series data (last 30 days)
export const mockTimeSeriesData: TimeSeriesData[] = [
  { date: '2026-02-17', tickets: 52, resolved: 48, avgResponseTime: 55, satisfaction: 4.5 },
  { date: '2026-02-18', tickets: 48, resolved: 45, avgResponseTime: 52, satisfaction: 4.6 },
  { date: '2026-02-19', tickets: 61, resolved: 55, avgResponseTime: 58, satisfaction: 4.4 },
  { date: '2026-02-20', tickets: 58, resolved: 54, avgResponseTime: 51, satisfaction: 4.7 },
  { date: '2026-02-21', tickets: 45, resolved: 43, avgResponseTime: 48, satisfaction: 4.8 },
  { date: '2026-02-22', tickets: 39, resolved: 38, avgResponseTime: 42, satisfaction: 4.7 },
  { date: '2026-02-23', tickets: 42, resolved: 40, avgResponseTime: 45, satisfaction: 4.6 },
  { date: '2026-02-24', tickets: 67, resolved: 62, avgResponseTime: 60, satisfaction: 4.5 },
  { date: '2026-02-25', tickets: 71, resolved: 68, avgResponseTime: 62, satisfaction: 4.6 },
  { date: '2026-02-26', tickets: 64, resolved: 61, avgResponseTime: 56, satisfaction: 4.7 },
  { date: '2026-02-27', tickets: 59, resolved: 57, avgResponseTime: 53, satisfaction: 4.8 },
  { date: '2026-02-28', tickets: 55, resolved: 52, avgResponseTime: 49, satisfaction: 4.7 },
  { date: '2026-03-01', tickets: 48, resolved: 46, avgResponseTime: 44, satisfaction: 4.8 },
  { date: '2026-03-02', tickets: 51, resolved: 49, avgResponseTime: 46, satisfaction: 4.7 },
  { date: '2026-03-03', tickets: 68, resolved: 65, avgResponseTime: 50, satisfaction: 4.6 },
  { date: '2026-03-04', tickets: 72, resolved: 69, avgResponseTime: 52, satisfaction: 4.7 },
  { date: '2026-03-05', tickets: 65, resolved: 63, avgResponseTime: 48, satisfaction: 4.8 },
  { date: '2026-03-06', tickets: 58, resolved: 56, avgResponseTime: 45, satisfaction: 4.8 },
  { date: '2026-03-07', tickets: 53, resolved: 51, avgResponseTime: 43, satisfaction: 4.7 },
  { date: '2026-03-08', tickets: 47, resolved: 46, avgResponseTime: 40, satisfaction: 4.9 },
  { date: '2026-03-09', tickets: 50, resolved: 48, avgResponseTime: 42, satisfaction: 4.8 },
  { date: '2026-03-10', tickets: 69, resolved: 66, avgResponseTime: 47, satisfaction: 4.7 },
  { date: '2026-03-11', tickets: 74, resolved: 71, avgResponseTime: 49, satisfaction: 4.8 },
  { date: '2026-03-12', tickets: 66, resolved: 64, avgResponseTime: 44, satisfaction: 4.8 },
  { date: '2026-03-13', tickets: 61, resolved: 59, avgResponseTime: 41, satisfaction: 4.9 },
  { date: '2026-03-14', tickets: 56, resolved: 54, avgResponseTime: 39, satisfaction: 4.8 },
  { date: '2026-03-15', tickets: 49, resolved: 48, avgResponseTime: 37, satisfaction: 4.9 },
  { date: '2026-03-16', tickets: 52, resolved: 50, avgResponseTime: 38, satisfaction: 4.8 },
  { date: '2026-03-17', tickets: 70, resolved: 68, avgResponseTime: 43, satisfaction: 4.7 },
  { date: '2026-03-18', tickets: 75, resolved: 72, avgResponseTime: 45, satisfaction: 4.7 },
];

// Channel distribution
export const mockChannelDistribution: ChannelDistribution[] = [
  { channel: 'Email', count: 738, percentage: 40 },
  { channel: 'WhatsApp', count: 738, percentage: 40 },
  { channel: 'Voice', count: 277, percentage: 15 },
  { channel: 'Web Form', count: 92, percentage: 5 },
];

// Priority breakdown
export const mockPriorityBreakdown: PriorityBreakdown[] = [
  { priority: 'Urgent', count: 92, avgResolutionTime: 2.5 },
  { priority: 'High', count: 369, avgResolutionTime: 8.2 },
  { priority: 'Medium', count: 1108, avgResolutionTime: 18.5 },
  { priority: 'Low', count: 277, avgResolutionTime: 48.3 },
];

// Agent performance
export const mockAgentPerformance: AgentPerformance[] = [
  {
    agent: 'Sarah Chen',
    ticketsHandled: 412,
    avgResponseTime: 38,
    avgResolutionTime: 16.2,
    satisfaction: 4.8,
  },
  {
    agent: 'Marcus Reid',
    ticketsHandled: 389,
    avgResponseTime: 42,
    avgResolutionTime: 17.8,
    satisfaction: 4.7,
  },
  {
    agent: 'Elena Rodriguez',
    ticketsHandled: 356,
    avgResponseTime: 45,
    avgResolutionTime: 18.5,
    satisfaction: 4.7,
  },
  {
    agent: 'James Park',
    ticketsHandled: 334,
    avgResponseTime: 48,
    avgResolutionTime: 19.2,
    satisfaction: 4.6,
  },
  {
    agent: 'Lisa Wang',
    ticketsHandled: 356,
    avgResponseTime: 46,
    avgResolutionTime: 18.9,
    satisfaction: 4.7,
  },
];

// Tag analytics
export const mockTopTags = [
  { tag: 'billing', count: 423 },
  { tag: 'bug', count: 385 },
  { tag: 'feature-request', count: 312 },
  { tag: 'integration', count: 278 },
  { tag: 'dashboard', count: 245 },
  { tag: 'api', count: 204 },
];
