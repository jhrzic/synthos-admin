import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { Activity, Zap, TrendingUp, Clock, Filter, Eye, RefreshCw } from 'lucide-react';

export interface VelocityDataPoint {
  timestamp: Date;
  scoutSignals: number;      // Raw signals & repos harvested by Scout
  analyticsTheses: number;   // Viability theses modeled by Analytics
  processingLatencySec: number; // Time in seconds for full scout-to-analytics cycle
  efficiencyScore: number;   // 0-100 token/cache efficiency index
}

// Generate realistic seed time-series data
export function generateSeedVelocityData(hours = 24): VelocityDataPoint[] {
  const data: VelocityDataPoint[] = [];
  const now = new Date();
  
  for (let i = hours; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 60 * 1000);
    // Base curves with time-of-day variations & upward agent efficiency trend
    const hourFactor = Math.sin((24 - i) / 3.5) * 15;
    const progressTrend = (24 - i) * 1.2;
    
    const scout = Math.max(20, Math.round(65 + hourFactor + progressTrend + (Math.random() * 18 - 9)));
    const analytics = Math.max(8, Math.round(scout * 0.32 + (Math.random() * 8 - 4)));
    const latency = Math.max(0.4, Number((2.8 - (24 - i) * 0.07 + (Math.random() * 0.4 - 0.2)).toFixed(2)));
    const efficiency = Math.min(99, Math.round(72 + (24 - i) * 0.95 + (Math.random() * 6 - 3)));

    data.push({
      timestamp: t,
      scoutSignals: scout,
      analyticsTheses: analytics,
      processingLatencySec: latency,
      efficiencyScore: efficiency,
    });
  }
  return data;
}

interface ResearchVelocityChartProps {
  data?: VelocityDataPoint[];
  className?: string;
  isLiveScraping?: boolean;
}

export const ResearchVelocityChart: React.FC<ResearchVelocityChartProps> = ({
  data: propData,
  className = '',
  isLiveScraping = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [timeRange, setTimeRange] = useState<'6h' | '24h' | '7d'>('24h');
  const [activeMetric, setActiveMetric] = useState<'all' | 'scout' | 'analytics' | 'latency'>('all');
  const [hoveredPoint, setHoveredPoint] = useState<VelocityDataPoint | null>(null);

  // Generate data based on timeRange if not supplied
  const chartData = useMemo(() => {
    if (propData && propData.length > 0) return propData;
    const hours = timeRange === '6h' ? 6 : timeRange === '24h' ? 24 : 168;
    return generateSeedVelocityData(hours);
  }, [propData, timeRange]);

  // Aggregate summary calculations
  const stats = useMemo(() => {
    if (!chartData.length) {
      return { totalScout: 0, totalAnalytics: 0, avgLatency: 0, avgEfficiency: 0 };
    }
    const totalScout = chartData.reduce((acc, d) => acc + d.scoutSignals, 0);
    const totalAnalytics = chartData.reduce((acc, d) => acc + d.analyticsTheses, 0);
    const avgLatency = (chartData.reduce((acc, d) => acc + d.processingLatencySec, 0) / chartData.length).toFixed(2);
    const avgEfficiency = Math.round(chartData.reduce((acc, d) => acc + d.efficiencyScore, 0) / chartData.length);
    const conversionRate = ((totalAnalytics / (totalScout || 1)) * 100).toFixed(1);

    return { totalScout, totalAnalytics, avgLatency, avgEfficiency, conversionRate };
  }, [chartData]);

  // Render D3 chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const containerWidth = containerRef.current.clientWidth || 640;
    const containerHeight = 260;
    const margin = { top: 20, right: 35, bottom: 35, left: 45 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    svg
      .attr('width', containerWidth)
      .attr('height', containerHeight)
      .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`);

    // Gradients Definition
    const defs = svg.append('defs');

    // Scout gradient (Airbyte Purple #615EFF)
    const scoutGradient = defs.append('linearGradient')
      .attr('id', 'scout-area-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    scoutGradient.append('stop').attr('offset', '0%').attr('stop-color', '#615EFF').attr('stop-opacity', 0.45);
    scoutGradient.append('stop').attr('offset', '100%').attr('stop-color', '#615EFF').attr('stop-opacity', 0.0);

    // Analytics gradient (Emerald #00D26A)
    const analyticsGradient = defs.append('linearGradient')
      .attr('id', 'analytics-area-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    analyticsGradient.append('stop').attr('offset', '0%').attr('stop-color', '#00D26A').attr('stop-opacity', 0.5);
    analyticsGradient.append('stop').attr('offset', '100%').attr('stop-color', '#00D26A').attr('stop-opacity', 0.0);

    // Main chart group
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale
    const xExtent = d3.extent(chartData, d => d.timestamp) as [Date, Date];
    const xScale = d3.scaleTime()
      .domain(xExtent)
      .range([0, width]);

    // Y scale (Left: Signals & Theses count)
    const maxSignal = d3.max(chartData, d => Math.max(d.scoutSignals, d.analyticsTheses * 2.2)) || 100;
    const yScale = d3.scaleLinear()
      .domain([0, maxSignal * 1.15])
      .range([height, 0]);

    // Y2 scale (Right: Latency in seconds)
    const maxLatency = d3.max(chartData, d => d.processingLatencySec) || 4;
    const y2Scale = d3.scaleLinear()
      .domain([0, maxLatency * 1.3])
      .range([height, 0]);

    // Gridlines (horizontal)
    const yGrid = d3.axisLeft(yScale)
      .ticks(5)
      .tickSize(-width)
      .tickFormat(() => '');

    g.append('g')
      .attr('class', 'grid')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#161828')
      .attr('stroke-dasharray', '3 3');

    g.select('.grid .domain').remove();

    // Axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(timeRange === '6h' ? 6 : timeRange === '24h' ? 8 : 7)
      .tickFormat((d) => {
        const date = d as Date;
        return timeRange === '7d' ? d3.timeFormat('%b %d')(date) : d3.timeFormat('%H:%M')(date);
      });

    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat(d => `${d}`);

    const y2Axis = d3.axisRight(y2Scale)
      .ticks(4)
      .tickFormat(d => `${d}s`);

    // Draw X Axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .attr('color', '#585E82')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#7B82A8');

    g.selectAll('.domain').attr('stroke', '#1A1D30');

    // Draw Y Axis (Left)
    g.append('g')
      .call(yAxis)
      .attr('color', '#585E82')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#7B82A8');

    // Draw Y2 Axis (Right) for Latency
    if (activeMetric === 'all' || activeMetric === 'latency') {
      g.append('g')
        .attr('transform', `translate(${width}, 0)`)
        .call(y2Axis)
        .attr('color', '#38BDF8')
        .selectAll('text')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#38BDF8');
    }

    // Line & Area Generators
    const scoutArea = d3.area<VelocityDataPoint>()
      .x(d => xScale(d.timestamp))
      .y0(height)
      .y1(d => yScale(d.scoutSignals))
      .curve(d3.curveMonotoneX);

    const scoutLine = d3.line<VelocityDataPoint>()
      .x(d => xScale(d.timestamp))
      .y(d => yScale(d.scoutSignals))
      .curve(d3.curveMonotoneX);

    const analyticsArea = d3.area<VelocityDataPoint>()
      .x(d => xScale(d.timestamp))
      .y0(height)
      .y1(d => yScale(d.analyticsTheses))
      .curve(d3.curveMonotoneX);

    const analyticsLine = d3.line<VelocityDataPoint>()
      .x(d => xScale(d.timestamp))
      .y(d => yScale(d.analyticsTheses))
      .curve(d3.curveMonotoneX);

    const latencyLine = d3.line<VelocityDataPoint>()
      .x(d => xScale(d.timestamp))
      .y(d => y2Scale(d.processingLatencySec))
      .curve(d3.curveMonotoneX);

    // Render Scout Layer (Purple)
    if (activeMetric === 'all' || activeMetric === 'scout') {
      g.append('path')
        .datum(chartData)
        .attr('fill', 'url(#scout-area-grad)')
        .attr('d', scoutArea);

      g.append('path')
        .datum(chartData)
        .attr('fill', 'none')
        .attr('stroke', '#615EFF')
        .attr('stroke-width', 2.2)
        .attr('d', scoutLine);
    }

    // Render Analytics Layer (Emerald)
    if (activeMetric === 'all' || activeMetric === 'analytics') {
      g.append('path')
        .datum(chartData)
        .attr('fill', 'url(#analytics-area-grad)')
        .attr('d', analyticsArea);

      g.append('path')
        .datum(chartData)
        .attr('fill', 'none')
        .attr('stroke', '#00D26A')
        .attr('stroke-width', 2.2)
        .attr('d', analyticsLine);
    }

    // Render Latency Cycle Line (Cyan Dash)
    if (activeMetric === 'all' || activeMetric === 'latency') {
      g.append('path')
        .datum(chartData)
        .attr('fill', 'none')
        .attr('stroke', '#38BDF8')
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '4 3')
        .attr('d', latencyLine);
    }

    // Crosshair & Hover Overlay
    const focusLine = g.append('line')
      .attr('stroke', '#8E94B8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 2')
      .attr('y1', 0)
      .attr('y2', height)
      .style('opacity', 0);

    const scoutPoint = g.append('circle')
      .attr('r', 4.5)
      .attr('fill', '#615EFF')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1.5)
      .style('opacity', 0);

    const analyticsPoint = g.append('circle')
      .attr('r', 4.5)
      .attr('fill', '#00D26A')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1.5)
      .style('opacity', 0);

    const bisectDate = d3.bisector<VelocityDataPoint, Date>(d => d.timestamp).left;

    // Transparent overlay for mouse movements
    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(chartData, x0, 1);
        const d0 = chartData[i - 1];
        const d1 = chartData[i];
        if (!d0) return;
        const d = !d1 ? d0 : (x0.getTime() - d0.timestamp.getTime() > d1.timestamp.getTime() - x0.getTime() ? d1 : d0);

        setHoveredPoint(d);

        const cx = xScale(d.timestamp);
        focusLine
          .attr('x1', cx)
          .attr('x2', cx)
          .style('opacity', 0.8);

        if (activeMetric === 'all' || activeMetric === 'scout') {
          scoutPoint
            .attr('cx', cx)
            .attr('cy', yScale(d.scoutSignals))
            .style('opacity', 1);
        }

        if (activeMetric === 'all' || activeMetric === 'analytics') {
          analyticsPoint
            .attr('cx', cx)
            .attr('cy', yScale(d.analyticsTheses))
            .style('opacity', 1);
        }
      })
      .on('mouseleave', () => {
        setHoveredPoint(null);
        focusLine.style('opacity', 0);
        scoutPoint.style('opacity', 0);
        analyticsPoint.style('opacity', 0);
      });

  }, [chartData, timeRange, activeMetric]);

  return (
    <div className={`bg-[#070810] border border-[#181B2E] rounded-2xl p-5 space-y-4 shadow-xl ${className}`}>
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#161828] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#615EFF]" />
            <h3 className="text-sm font-bold text-white font-['Space_Grotesk'] tracking-tight">
              Scout-to-Analytics Research Velocity
            </h3>
            {isLiveScraping && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D26A] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00D26A]"></span>
              </span>
            )}
          </div>
          <p className="text-[11px] font-mono text-[#8E94B8]">
            Real-time D3 telemetry of signal harvest velocity & agentic unit economics modeling.
          </p>
        </div>

        {/* Filters and Time Horizon */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Metric Selector Pills */}
          <div className="flex items-center bg-[#05060C] border border-[#1A1D30] rounded-xl p-0.5 text-[10px] font-mono">
            <button
              onClick={() => setActiveMetric('all')}
              className={`px-2.5 py-1 rounded-lg transition ${
                activeMetric === 'all'
                  ? 'bg-[#615EFF] text-white font-bold shadow'
                  : 'text-[#8E94B8] hover:text-white'
              }`}
            >
              All Signals
            </button>
            <button
              onClick={() => setActiveMetric('scout')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                activeMetric === 'scout'
                  ? 'bg-[#615EFF]/20 border border-[#615EFF] text-[#A5A2FF] font-bold'
                  : 'text-[#8E94B8] hover:text-[#A5A2FF]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#615EFF]"></span>
              Scout
            </button>
            <button
              onClick={() => setActiveMetric('analytics')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                activeMetric === 'analytics'
                  ? 'bg-[#00D26A]/20 border border-[#00D26A] text-[#00D26A] font-bold'
                  : 'text-[#8E94B8] hover:text-[#00D26A]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D26A]"></span>
              Analytics
            </button>
            <button
              onClick={() => setActiveMetric('latency')}
              className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                activeMetric === 'latency'
                  ? 'bg-[#38BDF8]/20 border border-[#38BDF8] text-[#38BDF8] font-bold'
                  : 'text-[#8E94B8] hover:text-[#38BDF8]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"></span>
              Latency
            </button>
          </div>

          {/* Time Window Switcher */}
          <div className="flex items-center bg-[#05060C] border border-[#1A1D30] rounded-xl p-0.5 text-[10px] font-mono">
            {(['6h', '24h', '7d'] as const).map(w => (
              <button
                key={w}
                onClick={() => setTimeRange(w)}
                className={`px-2 py-1 rounded-lg transition uppercase ${
                  timeRange === w
                    ? 'bg-[#181B34] text-white font-bold border border-[#2D335E]'
                    : 'text-[#6A7097] hover:text-white'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Metric Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#6A7097] block">SCOUT HARVEST RATE</span>
            <div className="text-white font-bold text-sm mt-0.5 flex items-center gap-1.5">
              <span>{stats.totalScout}</span>
              <span className="text-[10px] text-[#615EFF] font-normal">signals</span>
            </div>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#615EFF]/30 border border-[#615EFF] flex items-center justify-center">
            <span className="w-1 h-1 rounded-full bg-[#615EFF]"></span>
          </div>
        </div>

        <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#6A7097] block">ANALYTICS MODELED</span>
            <div className="text-[#00D26A] font-bold text-sm mt-0.5 flex items-center gap-1.5">
              <span>{stats.totalAnalytics}</span>
              <span className="text-[10px] text-[#00D26A]/70 font-normal">theses</span>
            </div>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#00D26A]/30 border border-[#00D26A] flex items-center justify-center">
            <span className="w-1 h-1 rounded-full bg-[#00D26A]"></span>
          </div>
        </div>

        <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#6A7097] block">MEAN CYCLE TIME</span>
            <div className="text-[#38BDF8] font-bold text-sm mt-0.5 flex items-center gap-1.5">
              <span>{stats.avgLatency}s</span>
              <span className="text-[9px] text-[#00D26A]">-48% trend</span>
            </div>
          </div>
          <Clock className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>

        <div className="p-3 bg-[#05060C] border border-[#161828] rounded-xl flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#6A7097] block">CONVERSION EFFICIENCY</span>
            <div className="text-[#A5A2FF] font-bold text-sm mt-0.5 flex items-center gap-1.5">
              <span>{stats.conversionRate}%</span>
              <span className="text-[10px] text-[#787E9F]">({stats.avgEfficiency} index)</span>
            </div>
          </div>
          <TrendingUp className="w-3.5 h-3.5 text-[#A5A2FF]" />
        </div>
      </div>

      {/* D3 SVG Container */}
      <div ref={containerRef} className="w-full relative overflow-hidden rounded-xl bg-[#040409] border border-[#141626] p-2">
        <svg ref={svgRef} className="w-full overflow-visible" />

        {/* Live Hover Tooltip Card */}
        {hoveredPoint && (
          <div className="absolute top-3 right-4 bg-[#0B0D1A]/95 border border-[#615EFF]/40 backdrop-blur-md px-3.5 py-2.5 rounded-xl shadow-2xl text-[11px] font-mono space-y-1.5 pointer-events-none z-20 animate-in fade-in duration-150">
            <div className="text-[#8E94B8] border-b border-[#1A1D30] pb-1 text-[10px] flex items-center justify-between gap-3">
              <span>{d3.timeFormat('%b %d, %H:%M')(hoveredPoint.timestamp)}</span>
              <span className="text-[#00D26A] font-bold">{hoveredPoint.efficiencyScore}% Eff.</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#615EFF] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#615EFF]"></span>
                Scout Signals:
              </span>
              <span className="text-white font-bold">{hoveredPoint.scoutSignals} / hr</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#00D26A] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D26A]"></span>
                Analytics Theses:
              </span>
              <span className="text-white font-bold">{hoveredPoint.analyticsTheses} / hr</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#38BDF8] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"></span>
                Cycle Latency:
              </span>
              <span className="text-white font-bold">{hoveredPoint.processingLatencySec}s</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart Legend & Footnote */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[#6A7097] pt-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#615EFF] rounded"></span>
            <span className="text-[#A5A2FF]">Scout Harvesting Vol. (Signals)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#00D26A] rounded"></span>
            <span className="text-[#00D26A]">Analytics Synthesis Vol. (Theses)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 border-b border-dashed border-[#38BDF8]"></span>
            <span className="text-[#38BDF8]">Cycle Latency (Right Axis)</span>
          </div>
        </div>

        <span className="text-[#4E5478]">
          Hermes board.db & OpenRouter sync active
        </span>
      </div>
    </div>
  );
};
