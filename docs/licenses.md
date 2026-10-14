# Third-party licenses — fonts, icons, images, code

Checklist item 19. Every font, icon, image and library that ships to a user
must be listed here with its license before it ships. If it isn't on this
list, it doesn't go in.

## Fonts

| Asset | Where | License | Status |
|---|---|---|---|
| System font stack (Tailwind default `font-sans`, `font-mono`) | All screens | Fonts belong to the viewer's operating system; nothing is bundled or served by CapNet | OK — no font files in the repo |

No web fonts are bundled or loaded from a CDN. If a brand font is added later,
record its license (and whether it permits web embedding) here first.

## Icons and images

| Asset | Where | License | Status |
|---|---|---|---|
| lucide-react icons | Prototypes | ISC | OK |

There are no photos, illustrations, logos or other image files in the repo.
A CapNet logo will need a record here once it exists: who designed it, and a
written assignment of rights to the company.

## Libraries (runtime)

| Package | License |
|---|---|
| next | MIT |
| react, react-dom | MIT |
| @clerk/nextjs | MIT |
| drizzle-orm | Apache-2.0 |
| pg | MIT |
| zod | MIT |
| lucide-react | ISC |

All are permissive licenses that allow commercial use. Keep their copyright
notices in any distributed build (Next.js does this by default).

Licenses above are as published by each project at the time of writing;
re-check when adding or upgrading a dependency.
