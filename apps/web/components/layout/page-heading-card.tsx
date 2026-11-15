import type { ReactNode } from 'react';

type PageHeadingCardProps = {
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
};

export function PageHeadingCard({ kicker, title, description }: PageHeadingCardProps) {
  return (
    <section className="ipam-card page-heading-card">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">{kicker}</span>
          <h1>{title}</h1>
        </div>
      </div>
      {description != null && <p className="page-heading-description">{description}</p>}
    </section>
  );
}
