const FOOTER_LINKS = [
  { label: 'Source for this version', href: 'https://github.com/3StanTech/RK-Config' },
  { label: 'Upstream KludgeKnight source', href: 'https://github.com/vinc3m1/kludgeknight' },
  { label: 'Themes by tweakcn', href: 'https://tweakcn.com/' },
];

/** Floating footer: unofficial notice, attribution and the full GPL notice. */
export function SiteFooter() {
  return (
    <footer className="float mx-auto mt-24 mb-6 grid w-[calc(100%-48px)] max-w-[1152px] grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-x-12 gap-y-6 p-6 text-sm max-[760px]:grid-cols-1 max-sm:w-[calc(100%-32px)]">
      <div>
        <p>RK Configurator is unofficial software, not affiliated with Royal Kludge.</p>
        <p className="mt-1.5 text-muted-foreground">
          A modified version of{' '}
          <a href="https://github.com/vinc3m1/kludgeknight" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            KludgeKnight
          </a>{' '}
          by Vince Mi, built through reverse engineering and referencing works like{' '}
          <a href="https://rnayabed.github.io/rangoli_website/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Rangoli
          </a>
          .
        </p>
        <ul className="mt-3.5 flex flex-wrap gap-2">
          {FOOTER_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-full border border-border px-3 py-1.5 text-[13px] text-foreground hover:border-ring"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
        <p>Kludge Knight - Browser-based Software for Royal Kludge Keyboards</p>
        <p>Copyright (C) 2025 Vince Mi (vinc3m1)</p>
        <p>RK Configurator is a modified version of Kludge Knight (2026), distributed under the same license.</p>
        <p>
          This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
          Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
          option) any later version.
        </p>
        <p>
          This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
          implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License
          for more details.
        </p>
      </div>
    </footer>
  );
}
