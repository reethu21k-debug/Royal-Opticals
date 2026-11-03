import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { cookies } from 'next/headers';
import LandingNav from './LandingNav';
import BannerCarousel from './BannerCarousel';
import styles from './landing.module.css';
import logo from '../../public/Logo.png'; // web/public/Logo.png (1444 × 418)

export const metadata: Metadata = {
  title: 'Royal Opticals — Eye tests, spectacles & contact lenses',
  description: 'Comprehensive eye tests, a wide range of frames, precision prescription lenses, contact lenses and repairs — all under one roof at Royal Opticals.',
};

/* ───────── EDIT THESE: your shop details appear in the Visit section and footer ───────── */
const SHOP = {
  phone: '+91 00000 00000',
  phoneHref: 'tel:+910000000000',
  email: 'hello@example.com',
  address: ['Shop no. 00, Main Road', 'City, State — 000000'],
  hours: [
    ['Monday – Saturday', '10:00 am – 8:00 pm'],
    ['Sunday', 'Closed'],
  ] as [string, string][],
};
const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SHOP.address.join(', '))}`;

const I: Record<string, JSX.Element> = {
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  frame: <><circle cx="6.5" cy="14" r="3.5" /><circle cx="17.5" cy="14" r="3.5" /><path d="M10 14h4M3 14l1.5-6M21 14l-1.5-6" /></>,
  lens: <><circle cx="12" cy="12" r="8.5" /><path d="M7.5 9.5A5.5 5.5 0 0 1 12 6.5" /></>,
  contact: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></>,
  kids: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2M9 9.5h.01M15 9.5h.01" /></>,
  repair: <path d="M14.5 6.5a4 4 0 0 0-5 5l-6 6a1.8 1.8 0 0 0 2.5 2.5l6-6a4 4 0 0 0 5-5l-2.5 2.5-2-.5-.5-2z" />,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};
const Ic = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" className={styles.ic} aria-hidden="true">{I[n]}</svg>;

const SERVICES = [
  { icon: 'eye', title: 'Eye examination', text: 'A thorough sight test to check your vision and eye comfort, so your prescription is right for how you live and work.' },
  { icon: 'frame', title: 'Spectacle & sun frames', text: 'A wide choice of styles, from light everyday frames to bold statement pieces — fitted so they sit comfortably.' },
  { icon: 'lens', title: 'Prescription lenses', text: 'Single vision, progressive and specialty lenses cut precisely to your prescription and your frame.' },
  { icon: 'contact', title: 'Contact lenses', text: 'Daily, monthly and specialty contact lenses, with guidance on fitting, handling and care.' },
  { icon: 'kids', title: 'Kids’ eyewear', text: 'Durable, flexible and fun frames sized for growing faces, with child-friendly fitting.' },
  { icon: 'repair', title: 'Repairs & adjustments', text: 'Loose screws, bent arms, new nose pads or a quick re-fit — bring them in and we’ll look after it.' },
];

const LENSES = [
  { name: 'Single vision', tag: 'Everyday', text: 'One prescription across the whole lens, for distance, reading or computer use.' },
  { name: 'Progressive', tag: 'No-line multifocal', text: 'Smooth transition between distance, intermediate and near vision without a visible line.' },
  { name: 'Blue-light filter', tag: 'Screen comfort', text: 'Designed for people who spend long hours on phones, laptops and monitors.' },
  { name: 'Photochromic', tag: 'Adapts to light', text: 'Lenses that darken outdoors and clear indoors, so one pair does more.' },
  { name: 'Anti-glare coating', tag: 'Clearer & cleaner', text: 'Reduces reflections for sharper night driving and better-looking lenses.' },
  { name: 'High-index (thin)', tag: 'Strong prescriptions', text: 'Thinner, lighter lenses for higher powers, so your glasses look and feel slimmer.' },
];

const STEPS = [
  { n: '1', title: 'Get your eyes tested', text: 'Visit for a sight test, or bring in a recent prescription.' },
  { n: '2', title: 'Choose your frame', text: 'Try on styles and get honest advice on fit, face shape and lifestyle.' },
  { n: '3', title: 'Pick the right lenses', text: 'We explain the options and recommend what suits your prescription and daily routine.' },
  { n: '4', title: 'Collect & aftercare', text: 'Your glasses are fitted to you, with free adjustments whenever they need a tweak.' },
];

const WHY = [
  { title: 'Clear, honest advice', text: 'We explain your options in plain language and recommend what you actually need.' },
  { title: 'Wide range, all budgets', text: 'Frames and lenses across styles and price points, so there is something for everyone.' },
  { title: 'Careful fitting', text: 'Precise measurements and hands-on fitting for comfort that lasts all day.' },
  { title: 'We look after you after', text: 'Adjustments, repairs and follow-up support long after you collect your glasses.' },
];

const FAQ = [
  { q: 'How often should I get my eyes tested?', a: 'Most adults benefit from an eye test every one to two years, or as advised by your optometrist. Children, people with diabetes and anyone noticing changes in vision may need to be seen more often.' },
  { q: 'Can I use a prescription from another clinic?', a: 'Yes. Bring in your most recent prescription and we can make your glasses from it. If it is more than a couple of years old, we recommend a fresh eye test.' },
  { q: 'How long does it take to make a pair of glasses?', a: 'Simple single-vision lenses are usually quicker, while progressive or specialty lenses take longer. Ask us in store and we will give you a clear collection date.' },
  { q: 'Do you repair and adjust glasses?', a: 'Yes. We can tighten screws, replace nose pads, straighten frames and re-fit glasses so they sit properly. Bring them in anytime.' },
  { q: 'Which lens is right for me?', a: 'It depends on your prescription, your daily routine and your budget. Tell us how you spend your day — screens, driving, reading, outdoors — and we will guide you.' },
];

export default function Landing() {
  const loggedIn = !!cookies().get('ro_session');
  return (
    <div className={styles.page} id="top">
      <LandingNav loggedIn={loggedIn} />

      {/* ───────── hero: banner carousel ───────── */}
      <h1 className={styles.sr}>Royal Opticals — eye tests, spectacles and contact lenses</h1>
      <BannerCarousel />

      {/* ───────── services ───────── */}
      <section id="services" className={styles.section}>
        <div className={styles.wrap}>
          <div className={styles.head}>
            <h2 className={styles.h2}>Everything for your eyes, in one place</h2>
            <p className={styles.sub}>From your first eye test to the final fitting, here is how we help you see and look better.</p>
          </div>
          <div className={styles.svc}>
            {SERVICES.map(s => (
              <article key={s.title} className={styles.svcItem}>
                <Ic n={s.icon} />
                <div><h3>{s.title}</h3><p>{s.text}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── lenses ───────── */}
      <section id="lenses" className={styles.section + ' ' + styles.warm}>
        <div className={styles.wrap}>
          <div className={styles.head}>
            <h2 className={styles.h2}>The right lens for the way you live</h2>
            <p className={styles.sub}>Not sure what you need? A quick guide to the most popular options — we will help you choose.</p>
          </div>
          <dl className={styles.spec}>
            <div className={styles.specHead} aria-hidden="true"><span>Lens</span><span>Best for</span><span>What it does</span></div>
            {LENSES.map(l => (
              <div key={l.name} className={styles.specRow}>
                <dt>{l.name}</dt>
                <dd className={styles.specTag}>{l.tag}</dd>
                <dd>{l.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ───────── process ───────── */}
      <section id="process" className={styles.section}>
        <div className={styles.wrap}>
          <div className={styles.head}>
            <h2 className={styles.h2}>From eye test to new glasses in four simple steps</h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map(s => (
              <li key={s.n}><span className={styles.num}>{s.n}</span><h3>{s.title}</h3><p>{s.text}</p></li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────── why ───────── */}
      <section className={styles.section + ' ' + styles.dark}>
        <div className={styles.wrap + ' ' + styles.whyGrid}>
          <h2 className={styles.h2}>Eyecare that feels personal</h2>
          <ul className={styles.whyList}>
            {WHY.map(w => (
              <li key={w.title}><Ic n="check" /><div><h3>{w.title}</h3><p>{w.text}</p></div></li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────── FAQ ───────── */}
      <section id="faq" className={styles.section}>
        <div className={styles.wrap + ' ' + styles.faqWrap}>
          <div className={styles.faqHead}>
            <h2 className={styles.h2}>Questions we hear often</h2>
            <p className={styles.sub}>Can’t find your answer? Call or visit us — we’re happy to help.</p>
          </div>
          <div className={styles.faq}>
            {FAQ.map(f => (
              <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── visit ───────── */}
      <section id="visit" className={styles.section + ' ' + styles.warm}>
        <div className={styles.wrap}>
          <div className={styles.head}>
            <h2 className={styles.h2}>Drop in or book your eye test</h2>
          </div>
          <div className={styles.visitGrid}>
            <dl className={styles.info}>
              <div><Ic n="pin" /><dt>Address</dt><dd>{SHOP.address.map(l => <span key={l}>{l}</span>)}</dd></div>
              <div><Ic n="clock" /><dt>Opening hours</dt>
                <dd className={styles.hours}>{SHOP.hours.map(([d, t]) => <span key={d}><em>{d}</em>{t}</span>)}</dd></div>
              <div><Ic n="phone" /><dt>Phone</dt><dd><a href={SHOP.phoneHref}>{SHOP.phone}</a></dd></div>
              <div><Ic n="mail" /><dt>Email</dt><dd><a href={`mailto:${SHOP.email}`}>{SHOP.email}</a></dd></div>
            </dl>
            <div className={styles.cta}>
              <h3>Ready for a clearer view?</h3>
              <p>Call us to book a sight test, or walk in to browse frames and talk to our team.</p>
              <a href={SHOP.phoneHref} className={styles.bigPhone}>{SHOP.phone}</a>
              <div className={styles.ctaBtns}>
                <a href={SHOP.phoneHref} className={styles.btnP + ' ' + styles.onDark}><Ic n="phone" /> Call now</a>
                <a href={directions} target="_blank" rel="noopener noreferrer" className={styles.btnS + ' ' + styles.onDark}><Ic n="pin" /> Get directions</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── footer ───────── */}
      <footer className={styles.foot}>
        <div className={styles.wrap + ' ' + styles.footIn}>
          <div className={styles.footBrand}>
            <Image src={logo} alt="Royal Opticals" unoptimized className={styles.logoImg} />
            <p>Eye tests, frames, lenses and care.</p>
          </div>
          <nav aria-label="Footer" className={styles.footLinks}>
            <a href="#services">Services</a><a href="#lenses">Lenses</a><a href="#faq">FAQ</a><a href="#visit">Visit us</a>
            <Link href={loggedIn ? '/dashboard' : '/login'}>Staff login</Link>
          </nav>
        </div>
        <div className={styles.wrap}><div className={styles.word} aria-hidden="true">Royal Opticals</div></div>
        <div className={styles.wrap + ' ' + styles.copy}>
          <span>© {new Date().getFullYear()} Royal Opticals. All rights reserved.</span>
          <a href="#top">Back to top</a>
        </div>
      </footer>
    </div>
  );
}