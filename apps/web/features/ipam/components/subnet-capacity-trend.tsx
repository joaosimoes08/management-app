'use client';

import type { SubnetCapacityHistory } from '../types';

const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(value));

export function SubnetCapacityTrend({ history }: { history: SubnetCapacityHistory | null }) {
  if (!history) return <section className="subnet-capacity-trend ipam-card" aria-busy="true"><span className="section-kicker">CAPACIDADE DA SUBNET</span><p>A carregar histórico…</p></section>;
  const ipv4 = history.subnet.version === 4;
  const samples = history.samples;
  const values = samples.map((sample) => ipv4 ? sample.utilizationPercent ?? 0 : sample.trackedAddresses);
  const max = Math.max(...values, ipv4 ? 100 : 1);
  const points = values.map((value, index) => `${samples.length < 2 ? 50 : 8 + index * (84 / (samples.length - 1))},${44 - (value / max) * 34}`).join(' ');
  const forecast = history.forecast;
  const forecastText = forecast.status === 'AVAILABLE'
    ? `Ao ritmo recente, capacidade total em cerca de ${forecast.daysUntilFull} dias (${dateLabel(forecast.projectedFullAt!)}).`
    : forecast.status === 'AT_CAPACITY' ? 'A subnet já atingiu a capacidade IPv4 utilizável.'
    : forecast.status === 'INSUFFICIENT_HISTORY' ? 'A previsão ficará disponível após pelo menos 3 registos ao longo de 7 dias.'
      : forecast.status === 'NO_GROWTH' ? 'Sem crescimento sustentado no período observado.'
        : forecast.status === 'LOW_CONFIDENCE' ? 'O ritmo varia demasiado para estimar uma data fiável.'
          : forecast.status === 'BEYOND_FORECAST_WINDOW' ? 'A capacidade não deverá esgotar-se dentro do horizonte de previsão de 12 meses.'
            : 'IPv6: endereços geridos ao longo do tempo; não se estima capacidade livre nem esgotamento do prefixo.';

  return <section className="subnet-capacity-trend ipam-card" aria-labelledby="subnet-capacity-title">
    <div className="panel-heading"><div><span className="section-kicker">CAPACIDADE DA SUBNET</span><h3 id="subnet-capacity-title">Tendência dos últimos 90 dias</h3><p className="panel-description">{ipv4 ? 'Alocação IPv4 face à capacidade utilizável.' : 'Endereços IPv6 registados no inventário; o prefixo não representa uma lista enumerável de endereços livres.'}</p></div></div>
    {samples.length ? <>
      <div className="subnet-capacity-chart-wrap">
        <div className="subnet-capacity-value">{ipv4 ? `${values.at(-1)}% utilizado` : `${values.at(-1)} endereços registados`}</div>
        <svg className="subnet-capacity-chart" viewBox="0 0 100 50" role="img" aria-label={ipv4 ? 'Tendência de utilização IPv4' : 'Tendência de endereços IPv6 registados'} preserveAspectRatio="none">
          <line x1="8" y1="10" x2="92" y2="10" />
          <line x1="8" y1="44" x2="92" y2="44" />
          {samples.length > 1 && <polyline points={points} />}
          {samples.length === 1 && <circle cx="50" cy={44 - (values[0] / max) * 34} r="1.5" />}
          {samples.length > 1 && <><circle cx={points.split(' ').at(-1)!.split(',')[0]} cy={points.split(' ').at(-1)!.split(',')[1]} r="1.5" /><circle cx={points.split(' ')[0].split(',')[0]} cy={points.split(' ')[0].split(',')[1]} r="1.5" /></>}
        </svg>
        <div className="subnet-capacity-dates"><span>{dateLabel(samples[0].sampledAt)}</span><span>{dateLabel(samples.at(-1)!.sampledAt)}</span></div>
      </div>
      <p className="subnet-capacity-forecast">{forecastText}</p>
      {ipv4 && forecast.dailyGrowth !== null && forecast.dailyGrowth > 0 && <small className="subnet-capacity-growth">Crescimento estimado: {forecast.dailyGrowth} endereços/dia</small>}
    </> : <p className="subnet-capacity-forecast">Ainda não há registos de capacidade.</p>}
  </section>;
}
