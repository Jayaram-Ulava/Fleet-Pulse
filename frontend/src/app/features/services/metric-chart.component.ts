import {
  AfterViewInit,
  Component,
  ElementRef,
  input,
  OnChanges,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import type { Chart as ChartInstance } from 'chart.js';
import { MetricHistoryPoint } from '../../core/models/metric-event.models';

export type MetricChartKey = 'p95' | 'errRate' | 'rps';

const SERIES_COLORS: Record<MetricChartKey, string> = {
  p95: '#176d63',
  errRate: '#a75b39',
  rps: '#48739a',
};

@Component({
  selector: 'app-metric-chart',
  templateUrl: './metric-chart.component.html',
  styleUrl: './metric-chart.component.scss',
})
export class MetricChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartCanvas') private chartCanvas?: ElementRef<HTMLCanvasElement>;

  readonly title = input.required<string>();
  readonly metricKey = input.required<MetricChartKey>();
  readonly unit = input.required<string>();
  readonly points = input.required<readonly MetricHistoryPoint[]>();
  readonly retry = output<void>();
  readonly renderError = signal<string | null>(null);

  private chart: ChartInstance<'line', number[], string> | null = null;
  private initialized = false;
  private destroyed = false;
  private renderRequestId = 0;
  private animationFrame: number | null = null;

  ngAfterViewInit(): void {
    this.initialized = true;
    void this.renderChart();
  }

  ngOnChanges(): void {
    if (!this.initialized || this.destroyed) {
      return;
    }

    if (this.chart) {
      this.scheduleChartUpdate();
    } else {
      void this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.renderRequestId += 1;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.chart?.destroy();
    this.chart = null;
  }

  retryRender(): void {
    this.renderError.set(null);
    this.chart?.destroy();
    this.chart = null;
    void this.renderChart();
    this.retry.emit();
  }

  private async renderChart(): Promise<void> {
    const requestId = ++this.renderRequestId;
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas || this.points().length === 0) {
      return;
    }

    try {
      const chartModule = await import('chart.js/auto');
      if (this.destroyed || requestId !== this.renderRequestId) {
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('A 2D canvas context is not available.');
      }

      this.chart = new chartModule.default(context, {
        type: 'line',
        data: this.chartData(),
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: false },
            tooltip: { displayColors: false },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 5, maxRotation: 0 },
            },
            y: {
              beginAtZero: this.metricKey() === 'errRate',
              ticks: {
                maxTicksLimit: 5,
                callback: (value) => `${value}${this.unit()}`,
              },
            },
          },
        },
      });
      this.renderError.set(null);
    } catch {
      if (requestId === this.renderRequestId) {
        this.renderError.set('This chart could not be rendered. Retry the chart.');
      }
    }
  }

  private scheduleChartUpdate(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      if (!this.chart || this.destroyed) {
        return;
      }

      const nextData = this.chartData();
      this.chart.data.labels = nextData.labels;
      this.chart.data.datasets[0].data = nextData.datasets[0].data;
      this.chart.update('none');
    });
  }

  private chartData(): {
    readonly labels: string[];
    readonly datasets: [
      {
        readonly label: string;
        readonly data: number[];
        readonly borderColor: string;
        readonly backgroundColor: string;
        readonly borderWidth: number;
        readonly pointRadius: number;
        readonly tension: number;
        readonly fill: boolean;
      },
    ];
  } {
    const metricKey = this.metricKey();
    return {
      labels: this.points().map((point) =>
        new Date(point.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ),
      datasets: [
        {
          label: this.title(),
          data: this.points().map((point) => point[metricKey]),
          borderColor: SERIES_COLORS[metricKey],
          backgroundColor: `${SERIES_COLORS[metricKey]}1a`,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true,
        },
      ],
    };
  }
}
