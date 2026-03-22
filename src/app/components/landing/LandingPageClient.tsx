"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Mail,
  MessageCircleMore,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import BlurRevealText from "./BlurRevealText";
import CardStackShowcase from "./CardStackShowcase";
import adminDarkSnapshot from "@/app/assets/landing-snapshots/admin-dark.png";
import adminLightSnapshot from "@/app/assets/landing-snapshots/admin-light.png";
import channelDarkSnapshot from "@/app/assets/landing-snapshots/channel-dark.png";
import channelLightSnapshot from "@/app/assets/landing-snapshots/channel-light.png";
import mailDarkSnapshot from "@/app/assets/landing-snapshots/mail-dark.png";
import mailLightSnapshot from "@/app/assets/landing-snapshots/mail-light.png";
import supportDarkSnapshot from "@/app/assets/landing-snapshots/support-dark.png";
import supportLightSnapshot from "@/app/assets/landing-snapshots/support-light.png";
import { landingBodyFont, landingDisplayFont, landingMonoFont } from "./fonts";
import WavesCanvas from "./WavesCanvas";
import styles from "./landing-page.module.css";

type LandingPageClientProps = {
  authenticated: boolean;
  workspaceHref: string;
};

const CHANNELS = [
  {
    name: "Email",
    Icon: Mail,
    body: "Shared inbox control with thread context, macros, attachment handling, and forward/reply flows built into the same operator surface.",
    points: ["Threaded history", "Attachment previews", "Pinned and routed mail", "Mailbox switching"]
  },
  {
    name: "WhatsApp",
    Icon: MessageCircleMore,
    body: "Delivery-aware messaging with resend logic, templates, 24-hour window handling, and customer context beside every exchange.",
    points: ["Sent, delivered, read states", "Template flows", "Media support", "Window-aware actions"]
  },
  {
    name: "Voice",
    Icon: PhoneCall,
    body: "Live call status, recordings, transcripts, outcomes, and outbound-call workflows that stay attached to the customer record.",
    points: ["Call progress states", "Transcripts and recordings", "Outcome tracking", "Outbound selection flows"]
  }
] as const;

const PLATFORM_METRICS = [
  { label: "Avg. first response", value: 18, suffix: " min" },
  { label: "Resolution rate", value: 94, suffix: "%" },
  { label: "CSAT signal", value: 4.8, suffix: "/5" },
  { label: "Channels unified", value: 3, suffix: "" }
] as const;

export default function LandingPageClient({ authenticated, workspaceHref }: LandingPageClientProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [navScrolled, setNavScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, []);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) {
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealVisible);
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );

    const animateCounter = (element: HTMLElement) => {
      if (element.dataset.counted === "true") {
        return;
      }
      element.dataset.counted = "true";

      const target = Number(element.dataset.counterTarget ?? "0");
      const suffix = element.dataset.counterSuffix ?? "";
      const prefix = element.dataset.counterPrefix ?? "";
      const duration = Number(element.dataset.counterDuration ?? "1600");
      const decimals = Number.isInteger(target) ? 0 : 1;
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextValue = target * eased;
        element.textContent = `${prefix}${nextValue.toFixed(decimals)}${suffix}`;
        if (progress < 1) {
          window.requestAnimationFrame(tick);
        } else {
          element.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`;
        }
      };

      window.requestAnimationFrame(tick);
    };

    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target as HTMLElement);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.45 }
    );

    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => revealObserver.observe(node));
    root.querySelectorAll<HTMLElement>("[data-counter-target]").forEach((node) => counterObserver.observe(node));

    const handleScroll = () => {
      const nextScrollY = window.scrollY;
      setNavScrolled(nextScrollY > 24);

      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(scrollable > 0 ? Math.min(1, nextScrollY / scrollable) : 0);

      root.querySelectorAll<HTMLElement>("[data-parallax-speed]").forEach((node) => {
        const speed = Number(node.dataset.parallaxSpeed ?? "0");
        const rect = node.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2 - window.innerHeight / 2;
        node.style.transform = `translate3d(0, ${midpoint * speed * -0.16}px, 0)`;
      });
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      revealObserver.disconnect();
      counterObserver.disconnect();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const workspaceLabel = authenticated ? "Open Workspace" : "Sign In";

  const showcaseItems = useMemo(
    () => [
      {
        id: "support-dark",
        eyebrow: "Support Workspace",
        title: "Omnichannel timelines",
        summary: "Queue, conversation, and customer context in one dense working surface.",
        preview: (
          <SnapshotPreview
            src={supportDarkSnapshot}
            alt="Dark support workspace view showing ticket list, conversation timeline, and customer details."
            theme="dark"
          />
        )
      },
      {
        id: "support-light",
        eyebrow: "Support Workspace",
        title: "Omnichannel timelines",
        summary: "The same operator surface in a light treatment for teams running a brighter workspace theme.",
        preview: (
          <SnapshotPreview
            src={supportLightSnapshot}
            alt="Light support workspace view showing ticket list, conversation timeline, and customer details."
            theme="light"
          />
        )
      },
      {
        id: "mail-dark",
        eyebrow: "Mail Surface",
        title: "Shared inbox control",
        summary: "Pinned threads, attachment handling, and reply flows without leaving the operating view.",
        preview: (
          <SnapshotPreview
            src={mailDarkSnapshot}
            alt="Dark shared inbox view showing thread list and billing discrepancy conversation."
            theme="dark"
          />
        )
      },
      {
        id: "mail-light",
        eyebrow: "Mail Surface",
        title: "Shared inbox control",
        summary: "The same inbox composition in a light treatment with thread selection and reply state visible.",
        preview: (
          <SnapshotPreview
            src={mailLightSnapshot}
            alt="Light shared inbox view showing thread list and billing discrepancy conversation."
            theme="light"
          />
        )
      },
      {
        id: "channel-dark",
        eyebrow: "Channel Drilldown",
        title: "Daily pattern visibility",
        summary: "Track inbound load, outbound share, and response movement inside a focused operational read.",
        preview: (
          <SnapshotPreview
            src={channelDarkSnapshot}
            alt="Dark channel drilldown view with inbound and outbound trend charts."
            theme="dark"
          />
        )
      },
      {
        id: "channel-light",
        eyebrow: "Channel Drilldown",
        title: "Daily pattern visibility",
        summary: "The same channel metrics view in a light treatment for quick comparative reading.",
        preview: (
          <SnapshotPreview
            src={channelLightSnapshot}
            alt="Light channel drilldown view with inbound and outbound trend charts."
            theme="light"
          />
        )
      },
      {
        id: "admin-dark",
        eyebrow: "Admin + Ops",
        title: "Guardrails and recovery",
        summary: "Permissions, SLA settings, and security posture modeled as first-class operational controls.",
        preview: (
          <SnapshotPreview
            src={adminDarkSnapshot}
            alt="Dark admin view showing users and roles, SLA targets, and security snapshot."
            theme="dark"
          />
        )
      },
      {
        id: "admin-light",
        eyebrow: "Admin + Ops",
        title: "Guardrails and recovery",
        summary: "The same admin surface in a light treatment with role management and security posture in view.",
        preview: (
          <SnapshotPreview
            src={adminLightSnapshot}
            alt="Light admin view showing users and roles, SLA targets, and security snapshot."
            theme="light"
          />
        )
      }
    ],
    []
  );

  return (
    <div ref={pageRef} className={`${styles.page} ${landingBodyFont.className}`}>
      <div className={styles.progressRail} aria-hidden="true">
        <span className={styles.progressFill} style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>

      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ""}`}>
        <a href="#top" className={styles.brandLockup}>
          <span className={styles.brandMark}>
            <BrandMark size={28} priority />
          </span>
        </a>
        <div className={styles.navLinks}>
          <a href="#channels">Channels</a>
          <a href="#platform">Platform</a>
          <a href="#metrics">Metrics</a>
          <Link href={workspaceHref} className={styles.navCta}>
            {workspaceLabel}
          </Link>
        </div>
      </nav>

      <section id="top" className={styles.hero}>
        <WavesCanvas
          className={styles.heroWaves}
          lineColor="rgba(255,255,255,0.22)"
          backgroundColor="#000000"
          waveAmplitudeX={42}
          waveAmplitudeY={18}
          xGap={14}
          yGap={38}
        />
        <div className={styles.heroNoise} />
        <div className={styles.heroGradient} />
        <div className={styles.heroInner}>
          <div data-reveal className={styles.heroEyebrow}>
            <span className={landingMonoFont.className}>Support CRM for teams who operate in public</span>
          </div>
          <div className={styles.heroHeadlineGroup}>
            <BlurRevealText
              text="Every signal."
              className={`${styles.heroLine} ${landingDisplayFont.className}`}
              delayMs={110}
            />
            <BlurRevealText
              text="One operating surface."
              className={`${styles.heroLine} ${styles.heroLineMuted} ${landingDisplayFont.className}`}
              delayMs={115}
            />
          </div>
          <div data-reveal className={styles.heroBodyRow}>
            <p className={styles.heroBody}>
              6esk brings email, WhatsApp, voice, AI drafts, merge reviews, analytics, and admin recovery
              into a single product surface for support teams that cannot afford drift.
            </p>
            <div className={styles.heroCapsule}>
              <span className={landingMonoFont.className}>Built for dense queues, high context, clean action.</span>
            </div>
          </div>
          <div data-reveal className={styles.heroActions}>
            <a href="#platform" className={styles.primaryAction}>
              Explore the product
              <ArrowRight className={styles.inlineIcon} />
            </a>
            <Link href={workspaceHref} className={styles.secondaryAction}>
              {workspaceLabel}
            </Link>
          </div>
          <div data-reveal className={styles.heroMetrics}>
            {PLATFORM_METRICS.map((metric) => (
              <div key={metric.label} className={styles.heroMetricCard}>
                <div className={`${styles.heroMetricValue} ${landingDisplayFont.className}`}>
                  {metric.value}
                  {metric.suffix}
                </div>
                <div className={styles.heroMetricLabel}>{metric.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.scrollHint}>
          <ChevronDown className={styles.scrollIcon} />
          <span className={landingMonoFont.className}>Scroll to inspect the system</span>
        </div>
      </section>

      <section id="platform" className={styles.platformSection}>
        <div className={styles.containerWide}>
          <div className={styles.platformGrid}>
            <div className={styles.platformCopy}>
              <div data-reveal className={styles.sectionLabel}>
                <span className={landingMonoFont.className}>Platform surfaces</span>
              </div>
              <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
                The product does not scatter.
                <br />
                It stacks.
              </h2>
              <p data-reveal className={styles.sectionIntro}>
                Support, mail, analytics, and admin all feel like different rooms inside the same building. The
                rotating stack on the right previews the exact product surfaces that keep operators moving.
              </p>
              <div data-reveal className={styles.featureBullets}>
                <div>
                  <Workflow size={18} />
                  <span>Merge reviews stay close to the queue, not buried in an admin graveyard.</span>
                </div>
                <div>
                  <Sparkles size={18} />
                  <span>AI suggestions appear inside the reply box, where the next action actually happens.</span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>Outbox failures, retries, and audit trails remain visible to operators who own the system.</span>
                </div>
              </div>
            </div>
            <div data-reveal className={styles.platformVisual}>
              <CardStackShowcase items={showcaseItems} />
            </div>
          </div>
        </div>
      </section>

      <section id="channels" className={styles.channelsSection}>
        <div className={styles.parallaxWord} data-parallax-speed="0.55">
          Channels
        </div>
        <div className={styles.container}>
          <div data-reveal className={styles.sectionLabel}>
            <span className={landingMonoFont.className}>One customer, one chronology</span>
          </div>
          <div className={styles.channelsHeader}>
            <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
              Where customers speak,
              <br />
              your team is already present.
            </h2>
            <p data-reveal className={styles.sectionIntro}>
              Each channel keeps its native behaviors, but the operator never loses context. That is the entire
              point of an omnichannel support product.
            </p>
          </div>
          <div className={styles.channelGrid}>
            {CHANNELS.map(({ name, Icon, body, points }, index) => (
              <article
                key={name}
                data-reveal
                className={styles.channelCard}
                style={{ transitionDelay: `${index * 120}ms` }}
              >
                <div className={styles.channelHeader}>
                  <span className={styles.channelIcon}>
                    <Icon size={20} />
                  </span>
                  <h3 className={styles.channelTitle}>{name}</h3>
                </div>
                <p className={styles.channelBody}>{body}</p>
                <ul className={styles.channelList}>
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="metrics" className={styles.metricsSection}>
        <div className={styles.parallaxWordSoft} data-parallax-speed="0.35">
          Evidence
        </div>
        <div className={styles.container}>
          <div data-reveal className={styles.sectionLabel}>
            <span className={landingMonoFont.className}>Measured operations</span>
          </div>
          <div className={styles.metricsHeader}>
            <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
              Real support work leaves a pattern.
            </h2>
            <p data-reveal className={styles.sectionIntro}>
              The landing page mirrors that idea with animated counters and a quiet analytics composition rather than
              generic marketing noise.
            </p>
          </div>
          <div className={styles.metricsGrid}>
            <div data-reveal className={styles.metricsBoard}>
              <div className={styles.metricsBoardHeader}>
                <div>
                  <p className={landingMonoFont.className}>Performance snapshot</p>
                  <h3>Support rhythm over the last 7 days</h3>
                </div>
                <BarChart3 size={18} />
              </div>
              <div className={styles.chartArea}>
                <div className={styles.chartCurve}>
                  <span style={{ height: "40%" }} />
                  <span style={{ height: "58%" }} />
                  <span style={{ height: "50%" }} />
                  <span style={{ height: "76%" }} />
                  <span style={{ height: "64%" }} />
                  <span style={{ height: "82%" }} />
                  <span style={{ height: "70%" }} />
                </div>
                <div className={styles.chartLegend}>
                  <div>
                    <strong>Inbound load</strong>
                    <span>balanced across email, WhatsApp, and voice</span>
                  </div>
                  <div>
                    <strong>Operator response</strong>
                    <span>kept inside target range through AI and saved views</span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.counterGrid}>
              {[
                { label: "Average handle time", target: 6.4, suffix: " min" },
                { label: "Draft acceptance", target: 72, suffix: "%" },
                { label: "Delivered WhatsApp events", target: 98, suffix: "%" },
                { label: "Recovered failed jobs", target: 43, suffix: "" }
              ].map((metric, index) => (
                <article
                  key={metric.label}
                  data-reveal
                  className={styles.counterCard}
                  style={{ transitionDelay: `${index * 110}ms` }}
                >
                  <div
                    className={`${styles.counterValue} ${landingDisplayFont.className}`}
                    data-counter-target={metric.target}
                    data-counter-suffix={metric.suffix}
                    data-counter-duration="1700"
                  >
                    0{metric.suffix}
                  </div>
                  <p className={styles.counterLabel}>{metric.label}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.sequenceSection}>
        <div className={styles.container}>
          <div data-reveal className={styles.sectionLabel}>
            <span className={landingMonoFont.className}>Resolution sequence</span>
          </div>
          <div className={styles.sequenceGrid}>
            {[
              "Capture the message, call, or thread the moment it lands.",
              "Surface the customer history, current ticket, and interaction shortcuts beside the reply context.",
              "Draft, route, retry, merge, and measure without leaving the operating plane."
            ].map((step, index) => (
              <article
                key={step}
                data-reveal
                className={styles.sequenceCard}
                style={{ transitionDelay: `${index * 120}ms` }}
              >
                <span className={`${styles.sequenceNumber} ${landingMonoFont.className}`}>0{index + 1}</span>
                <p>{step}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.ctaSection}>
        <div className={styles.container}>
          <div className={styles.ctaPanel} data-reveal>
            <p className={`${styles.ctaEyebrow} ${landingMonoFont.className}`}>6esk</p>
            <h2 className={`${styles.ctaTitle} ${landingDisplayFont.className}`}>
              If support is operationally serious,
              <br />
              the software should be too.
            </h2>
            <p className={styles.ctaBody}>
              Open the workspace, inspect the product, or send a public request through the same system the team uses.
            </p>
            <div className={styles.ctaActions}>
              <Link href={workspaceHref} className={styles.primaryAction}>
                {workspaceLabel}
                <ArrowRight className={styles.inlineIcon} />
              </Link>
              <Link href="/support" className={styles.secondaryActionDark}>
                Public Support Form
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerGrid}>
            <div>
              <div className={styles.footerBrand}>
                <BrandMark size={26} />
              </div>
              <p className={styles.footerTagline}>Omnichannel support, one deliberate operating surface.</p>
            </div>
            <div className={styles.footerLinks}>
              <a href="#channels">Channels</a>
              <a href="#platform">Platform</a>
              <a href="#metrics">Metrics</a>
              <Link href={workspaceHref}>{workspaceLabel}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

type SnapshotPreviewProps = {
  src: StaticImageData;
  alt: string;
  theme: "dark" | "light";
};

function SnapshotPreview({ src, alt, theme }: SnapshotPreviewProps) {
  return (
    <div className={`${styles.snapshotPreview} ${theme === "dark" ? styles.snapshotPreviewDark : styles.snapshotPreviewLight}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 780px) 92vw, (max-width: 1120px) 80vw, 720px"
        className={styles.snapshotImage}
      />
      <span className={styles.snapshotTone} aria-hidden="true" />
    </div>
  );
}
