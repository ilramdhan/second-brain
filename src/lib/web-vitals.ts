// Core Web Vitals collection (LCP, CLS, INP, FCP, TTFB). Lazy-loaded by src/lib/monitoring.ts.
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

export type VitalReport = {
  name: Metric["name"];
  value: number;
  rating: Metric["rating"];
  /** Path only, no query string (search text, ids in filters). */
  route: string;
  navigationType: Metric["navigationType"];
};

export function toVitalReport(metric: Metric, pathname: string): VitalReport {
  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    route: pathname,
    navigationType: metric.navigationType,
  };
}

export function observeWebVitals(report: (vital: VitalReport) => void) {
  const send = (metric: Metric) => report(toVitalReport(metric, window.location.pathname));
  onLCP(send);
  onCLS(send);
  onINP(send);
  onFCP(send);
  onTTFB(send);
}
