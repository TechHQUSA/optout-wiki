// tests/contribute-page.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Contribute from '../src/pages/contribute.astro';

test('contribute page has form, honeypot, altcha widget, pipeline', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Contribute);
  expect(html).toContain('id="contribute-form"');
  expect(html).toContain('name="website"'); // honeypot
  expect(html).toContain('altcha-widget');
  expect(html).toContain('Draft'); // pipeline stage 1
  expect(html).toContain('id="vetting"'); // forward-dep: footer links /contribute#vetting
});

test('contribute page carries the Guide/Software toggle and both field sets', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Contribute);
  expect(html).toContain('id="ctype-guide"');
  expect(html).toContain('id="ctype-software"');
  expect(html).toContain('name="sw-name"');
  expect(html).toContain('name="sw-url"');
  expect(html).toContain('name="sw-summary"');
  expect(html).toContain('name="sw-tags"');
  expect(html).toContain('name="sw-justification"');
  expect(html).toContain('name="sw-sources"');
  // software fieldset starts disabled (guide is the default type)
  expect(html).toMatch(/<fieldset class="fields-software[^"]*" disabled/);
});
