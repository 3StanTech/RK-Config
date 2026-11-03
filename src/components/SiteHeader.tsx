import { ThemeSelector } from './ThemeSelector';
import { ThemeToggle } from './ThemeToggle';

const SECTION_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Models', href: '#models' },
  { label: 'Safety', href: '#safety' },
  { label: 'Questions', href: '#questions' },
];

const SOURCE_URL = 'https://github.com/3StanTech/RK-Config';

interface SiteHeaderProps {
  /** Set in the editor: shown beside the wordmark; section links (home anchors) are hidden. */
  deviceName?: string;
}

/** Floating header pill over the Stage canvas. */
export function SiteHeader({ deviceName }: SiteHeaderProps) {
  const wordmark = (
    <>
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px] bg-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_25%,transparent)]" />
      <span>RK Configurator</span>
    </>
  );

  return (
    <header className="float sticky top-3.5 z-40 mx-auto mt-3.5 flex w-[calc(100%-32px)] max-w-[1300px] items-center gap-[18px] rounded-full py-2 pr-2 pl-[18px] max-sm:flex-wrap max-sm:gap-2.5 max-sm:gap-y-2 max-sm:rounded-[calc(var(--radius)+10px)] max-sm:pl-3.5">
      {deviceName ? (
        <h1 className="flex items-center gap-2.5 text-[15px] font-bold tracking-[-0.01em] whitespace-nowrap">
          {wordmark}
          <span className="text-[13px] font-medium text-muted-foreground max-sm:hidden">{deviceName}</span>
        </h1>
      ) : (
        <a href="#main-content" className="flex items-center gap-2.5 text-[15px] font-bold tracking-[-0.01em] whitespace-nowrap text-foreground no-underline">
          {wordmark}
        </a>
      )}

      {!deviceName && (
        <nav aria-label="Sections" className="flex gap-0.5 max-[1240px]:hidden">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-[7px] text-[13.5px] whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full px-3 py-[7px] text-[13.5px] whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Source
          </a>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="max-sm:hidden">
          Themes by{' '}
          <a href="https://tweakcn.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            tweakcn
          </a>
          :
        </span>
        <ThemeSelector />
        <ThemeToggle />
      </div>
    </header>
  );
}
