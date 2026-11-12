type ActionLinkProps = {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
};

export function ActionLink({
  href,
  label,
  variant = "primary",
}: ActionLinkProps) {
  const className = `button button-${variant}`;

  if (!href) {
    return (
      <span className={`${className} button-disabled`} aria-disabled="true">
        {label}
      </span>
    );
  }

  return (
    <a
      className={className}
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      {label}
    </a>
  );
}
