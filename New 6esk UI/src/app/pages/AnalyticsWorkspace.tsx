import { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  ChevronDown,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  mockKPIMetrics,
  mockTimeSeriesData,
  mockChannelDistribution,
  mockPriorityBreakdown,
  mockAgentPerformance,
  mockTopTags,
  type KPIMetric,
} from '../data/mockAnalytics';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { cn } from '../components/ui/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

type TimeRange = '7d' | '30d' | '90d' | 'all';

export function AnalyticsWorkspace() {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');

  const timeRangeLabels: Record<TimeRange, string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    all: 'All time',
  };

  const formatValue = (metric: KPIMetric) => {
    const value = metric.value;
    
    switch (metric.format) {
      case 'number':
        return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString();
      case 'duration':
        return value.toString();
      case 'percentage':
        return value.toFixed(1);
      case 'currency':
        return `$${value.toLocaleString()}`;
      default:
        return value.toString();
    }
  };

  // Chart colors
  const COLORS = {
    primary: '#3b82f6',
    secondary: '#8b5cf6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    neutral: '#6b7280',
  };

  const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="h-full bg-neutral-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Analytics</h1>
            <p className="text-sm text-neutral-600">
              Performance metrics and insights for your support team
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  {timeRangeLabels[timeRange]}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTimeRange('7d')}>
                  Last 7 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange('30d')}>
                  Last 30 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange('90d')}>
                  Last 90 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange('all')}>All time</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockKPIMetrics.map((metric) => (
            <KPICard key={metric.id} metric={metric} formatValue={formatValue} />
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Ticket Volume Over Time */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Ticket Volume</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mockTimeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => {
                    const d = new Date(date);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                  stroke="#9ca3af"
                  fontSize={12}
                />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(date) => {
                    const d = new Date(date);
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="tickets"
                  name="Created"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="resolved"
                  name="Resolved"
                  stroke={COLORS.success}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Response Time Trend */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Avg Response Time (min)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mockTimeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => {
                    const d = new Date(date);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                  stroke="#9ca3af"
                  fontSize={12}
                />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(date) => {
                    const d = new Date(date);
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avgResponseTime"
                  name="Response Time"
                  stroke={COLORS.secondary}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Channel Distribution */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Tickets by Channel</h3>
            <div className="flex items-center justify-between">
              <ResponsiveContainer width="50%" height={250}>
                <PieChart>
                  <Pie
                    data={mockChannelDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {mockChannelDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3 pl-4">
                {mockChannelDistribution.map((item, index) => (
                  <div key={item.channel} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-sm text-neutral-700">{item.channel}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{item.count}</p>
                      <p className="text-xs text-neutral-500">{item.percentage}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Priority Breakdown */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Tickets by Priority</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mockPriorityBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="priority" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Customer Satisfaction */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Customer Satisfaction Score</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={mockTimeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => {
                    const d = new Date(date);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                  stroke="#9ca3af"
                  fontSize={12}
                />
                <YAxis domain={[4.0, 5.0]} stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(date) => {
                    const d = new Date(date);
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="satisfaction"
                  name="CSAT Score"
                  stroke={COLORS.success}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Top Tags */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Top Tags</h3>
            <div className="space-y-3">
              {mockTopTags.map((item, index) => {
                const maxCount = mockTopTags[0].count;
                const percentage = (item.count / maxCount) * 100;
                return (
                  <div key={item.tag}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-neutral-700">{item.tag}</span>
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                    <div className="w-full bg-neutral-100 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Agent Performance Table */}
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Agent Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-neutral-600">
                    Agent
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">
                    Tickets Handled
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">
                    Avg Response (min)
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">
                    Avg Resolution (hrs)
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">
                    Satisfaction
                  </th>
                </tr>
              </thead>
              <tbody>
                {mockAgentPerformance.map((agent, index) => (
                  <tr
                    key={agent.agent}
                    className={cn(
                      'border-b border-neutral-100',
                      index % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'
                    )}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium">
                          {agent.agent.charAt(0)}
                        </div>
                        <span className="font-medium text-sm">{agent.agent}</span>
                      </div>
                    </td>
                    <td className="text-right py-3 px-4 text-sm">{agent.ticketsHandled}</td>
                    <td className="text-right py-3 px-4 text-sm">{agent.avgResponseTime}</td>
                    <td className="text-right py-3 px-4 text-sm">{agent.avgResolutionTime}</td>
                    <td className="text-right py-3 px-4">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          agent.satisfaction >= 4.7
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        )}
                      >
                        {agent.satisfaction.toFixed(1)}/5
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function KPICard({
  metric,
  formatValue,
}: {
  metric: KPIMetric;
  formatValue: (metric: KPIMetric) => string;
}) {
  const isPositiveChange = metric.trend === 'up';
  const isGoodChange =
    (metric.id.includes('time') && metric.trend === 'down') ||
    (!metric.id.includes('time') && metric.trend === 'up');

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-neutral-600">{metric.label}</p>
        <div
          className={cn(
            'flex items-center gap-1 text-xs px-2 py-1 rounded-full',
            isGoodChange
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          )}
        >
          {isPositiveChange ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {Math.abs(metric.change).toFixed(1)}%
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <p className="text-3xl font-semibold">{formatValue(metric)}</p>
        {metric.unit && <span className="text-sm text-neutral-500">{metric.unit}</span>}
      </div>
      <p className="text-xs text-neutral-500 mt-2">vs previous period</p>
    </Card>
  );
}
