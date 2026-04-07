"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  ChevronDown,
  Mail,
  MessageCircleMore,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow
} from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/app/workspace/components/ui/dialog";
import { cn } from "@/app/workspace/components/ui/utils";
import BlurRevealText from "./BlurRevealText";
import CardStackShowcase from "./CardStackShowcase";
import adminDarkSnapshot from "@/app/assets/landing-snapshots/admin-dark.png";
import channelDarkSnapshot from "@/app/assets/landing-snapshots/channel-dark.png";
import mailDarkSnapshot from "@/app/assets/landing-snapshots/mail-dark.png";
import supportDarkSnapshot from "@/app/assets/landing-snapshots/support-dark.png";
import { landingBodyFont, landingDisplayFont, landingMonoFont } from "./fonts";
import WavesCanvas from "./WavesCanvas";
import styles from "./landing-page.module.css";
import heroVisual from "@/app/assets/edited hero image.png";
import landingWordmark from "@/app/assets/landing-wordmark.png";
import { setStoredDemoMode } from "@/app/lib/demo-mode";

type LandingPageClientProps = {
  signInHref: string;
  demoWorkspaceHref: string;
};

const CHANNELS = [
  {
    name: "Email",
    Icon: Mail,
    body: "Full inbox control - threads, attachments, macros, and routing - without ever leaving the queue.",
    points: [
      "Never lose a prior exchange",
      "Route to the right agent, automatically",
      "AI drafts, routes, and resolves without a human in the loop"
    ]
  },
  {
    name: "WhatsApp",
    Icon: MessageCircleMore,
    body: "WhatsApp that respects the 24-hour window. Templates, delivery states, full context - built in, not bolted on.",
    points: [
      "Know exactly when a message lands",
      "Send compliant templates in one click",
      "AI manages the 24-hour window and sends templates automatically"
    ]
  },
  {
    name: "Voice",
    Icon: PhoneCall,
    body: "Every call logged, transcribed, and tied to the customer record. Nothing lives in a separate dialer ever again.",
    points: [
      "Live call status across the team",
      "Full record attached to every ticket",
      "AI transcribes and logs outcomes in real time"
    ]
  },
  {
    name: "AI Agent",
    Icon: Bot,
    body: "Not a chatbot. A full operator. Reads context, drafts, sends, escalates, and closes - across every channel, autonomously.",
    points: [
      "End-to-end resolution without human input",
      "Escalates with full context, nothing resets",
      "Full audit trail on every AI action"
    ]
  }
] as const;

const PLATFORM_METRICS = [
  { label: "Avg. first response", value: 1, suffix: " min" },
  { label: "Resolution rate", value: 94, suffix: "%" },
  { label: "CSAT signal", value: 4.8, suffix: "/5" }
] as const;

const SOUTH_AFRICA_STARTUPS = [
  "Yoco",
  "Stitch",
  "Paymenow",
  "Omniscient",
  "TurnStay",
  "Sticitt",
  "UsPlus",
  "Tata-iMali"
] as const;

const FOOTER_SECTIONS = [
  {
    title: "Products",
    items: [
      { label: "Pricing" },
      { label: "Integrations" },
      { label: "System status" },
      { label: "Sign in", href: "workspace" as const }
    ]
  },
  {
    title: "Features",
    items: [
      { label: "AI agents" },
      { label: "Voice" },
      { label: "Ticketing system" },
      { label: "Reporting and analytics" },
      { label: "Messaging and live chat" },
      { label: "See all features →" }
    ]
  },
  {
    title: "Resources",
    items: [
      { label: "Security" },
      { label: "Training" },
      { label: "Partners" },
      { label: "Professional services" },
      { label: "What is CRM?" },
      { label: "CRM software guide" },
      { label: "Help center", href: "/support" }
    ]
  },
  {
    title: "Company",
    items: [
      { label: "About us" },
      { label: "What is 6esk?" },
      { label: "Careers" },
      { label: "Legal" },
      { label: "Product updates" }
    ]
  }
] as const;

export default function LandingPageClient({ signInHref, demoWorkspaceHref }: LandingPageClientProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [navScrolled, setNavScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [bookCallOpen, setBookCallOpen] = useState(false);
  const [footerExpanded, setFooterExpanded] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    email: "",
    phone: "",
    date: "",
    time: ""
  });

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

  const navCtaLabel = "Sign In";

  const handleOpenWorkspace = () => {
    setStoredDemoMode(true);
  };

  const handleSignInNavigation = () => {
    setStoredDemoMode(false);
  };

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
      }
    ],
    []
  );

  const startupMarqueeItems = useMemo(
    () => [...SOUTH_AFRICA_STARTUPS, ...SOUTH_AFRICA_STARTUPS],
    []
  );

  const handleBookingFieldChange = (field: keyof typeof bookingForm, value: string) => {
    setBookingForm((current) => ({ ...current, [field]: value }));
  };

  const handleBookCallSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const subject = "Book a call - 6esk";
    const body = [
      "Booking request",
      "",
      `Email: ${bookingForm.email}`,
      `Phone: ${bookingForm.phone}`,
      `Preferred date: ${bookingForm.date}`,
      `Preferred time: ${bookingForm.time}`
    ].join("\n");

    window.location.href = `mailto:support@6esk.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setBookCallOpen(false);
  };

  return (
    <div ref={pageRef} className={`${styles.page} ${landingBodyFont.className}`}>
      <div className={styles.progressRail} aria-hidden="true">
        <span className={styles.progressFill} style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>

      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ""}`}>
          <a href="#top" className={styles.brandLockup}>
          <span className={styles.brandWordmarkLockup}>
            <Image
              src={landingWordmark}
              alt="6esk"
              priority
              className={styles.brandWordmarkImage}
              sizes="(max-width: 780px) 132px, 170px"
            />
          </span>
        </a>
        <div className={styles.navLinks}>
          <a href="#channels">Channels</a>
          <a href="#platform">Platform</a>
          <Link href={signInHref} className={styles.navCta} onClick={handleSignInNavigation}>
            {navCtaLabel}
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
          <div data-reveal className={styles.heroVisualWrap}>
            <div className={styles.heroVisualFrame}>
              <Image
                src={heroVisual}
                alt="6esk hero product mark"
                priority
                className={styles.heroVisual}
                sizes="(max-width: 780px) 82vw, (max-width: 1120px) 54vw, 46vw"
              />
            </div>
          </div>
          <div className={styles.heroContent}>
            <div data-reveal className={styles.heroEyebrow}>
              <span className={landingMonoFont.className}>Support CRM for teams running every customer channel</span>
            </div>
            <div data-reveal className={styles.heroHeadlineSupport} aria-hidden="true">
              <div className={styles.heroHeadlineSupportHeader}>
                <div className={`${styles.heroHeadlineSupportLabel} ${landingMonoFont.className}`}>Live context</div>
                <span className={styles.heroHeadlineSupportPulse} />
              </div>
              <div className={styles.heroHeadlineSupportRows}>
                <div className={styles.heroHeadlineSupportRow}>
                  <Mail className={styles.heroHeadlineSupportIcon} />
                  <span>Email</span>
                  <span className={`${styles.heroHeadlineSupportState} ${landingMonoFont.className}`}>threaded</span>
                </div>
                <div className={styles.heroHeadlineSupportRow}>
                  <MessageCircleMore className={styles.heroHeadlineSupportIcon} />
                  <span>WhatsApp</span>
                  <span className={`${styles.heroHeadlineSupportState} ${landingMonoFont.className}`}>live</span>
                </div>
                <div className={styles.heroHeadlineSupportRow}>
                  <PhoneCall className={styles.heroHeadlineSupportIcon} />
                  <span>Voice</span>
                  <span className={`${styles.heroHeadlineSupportState} ${landingMonoFont.className}`}>recorded</span>
                </div>
                <div className={styles.heroHeadlineSupportRow}>
                  <Bot className={styles.heroHeadlineSupportIcon} />
                  <span>AI Agent</span>
                  <span className={`${styles.heroHeadlineSupportState} ${landingMonoFont.className}`}>FULL-AUTO</span>
                </div>
              </div>
            </div>
            <div className={styles.heroHeadlineGroup}>
              <BlurRevealText
                text="If support"
                className={`${styles.heroLine} ${styles.heroLineTop} ${landingDisplayFont.className}`}
                delayMs={110}
                wrap={false}
              />
              <BlurRevealText
                text="is serious,"
                className={`${styles.heroLine} ${styles.heroLineMuted} ${styles.heroLineMiddle} ${landingDisplayFont.className}`}
                delayMs={115}
                wrap={false}
              />
              <BlurRevealText
                text="the software"
                className={`${styles.heroLine} ${styles.heroLineMuted} ${styles.heroLineLower} ${landingDisplayFont.className}`}
                delayMs={120}
                wrap={false}
              />
              <BlurRevealText
                text="should be too."
                className={`${styles.heroLine} ${styles.heroLineMuted} ${styles.heroLineBottom} ${landingDisplayFont.className}`}
                delayMs={120}
                wrap={false}
              />
            </div>
            <div data-reveal className={styles.heroBodyRow}>
              <p className={styles.heroBody}>
                Email, WhatsApp, Voice, and Tickets in one operating queue. Run it yourself, hand
                routine work to AI, or split control without losing context.
              </p>
            </div>
            <div data-reveal className={styles.heroActions}>
              <Link href={demoWorkspaceHref} className={styles.primaryAction} onClick={handleOpenWorkspace}>
                Open Workspace Free
                <ArrowRight className={styles.inlineIcon} />
              </Link>
              <button type="button" className={styles.secondaryAction} onClick={() => setBookCallOpen(true)}>
                Book a call
              </button>
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
        </div>
        <div className={styles.scrollHint}>
          <ChevronDown className={styles.scrollIcon} />
          <span className={landingMonoFont.className}>Scroll to inspect the system</span>
        </div>
      </section>

      <Dialog open={bookCallOpen} onOpenChange={setBookCallOpen}>
        <DialogContent className={styles.bookingDialog}>
          <DialogHeader className={styles.bookingDialogHeader}>
            <DialogTitle className={`${styles.bookingDialogTitle} ${landingDisplayFont.className}`}>
              Book a call
            </DialogTitle>
            <DialogDescription className={styles.bookingDialogDescription}>
              Leave your email, phone number, and preferred date and time. We&apos;ll open your email
              client with the request prefilled.
            </DialogDescription>
          </DialogHeader>
          <form className={styles.bookingForm} onSubmit={handleBookCallSubmit}>
            <label className={styles.bookingField}>
              <span className={`${styles.bookingFieldLabel} ${landingMonoFont.className}`}>Email</span>
              <input
                type="email"
                required
                value={bookingForm.email}
                onChange={(event) => handleBookingFieldChange("email", event.target.value)}
                className={styles.bookingInput}
                placeholder="you@company.com"
              />
            </label>
            <label className={styles.bookingField}>
              <span className={`${styles.bookingFieldLabel} ${landingMonoFont.className}`}>Phone number</span>
              <input
                type="tel"
                required
                value={bookingForm.phone}
                onChange={(event) => handleBookingFieldChange("phone", event.target.value)}
                className={styles.bookingInput}
                placeholder="+27 00 000 0000"
              />
            </label>
            <div className={styles.bookingRow}>
              <label className={styles.bookingField}>
                <span className={`${styles.bookingFieldLabel} ${landingMonoFont.className}`}>Preferred date</span>
                <input
                  type="date"
                  required
                  value={bookingForm.date}
                  onChange={(event) => handleBookingFieldChange("date", event.target.value)}
                  className={styles.bookingInput}
                />
              </label>
              <label className={styles.bookingField}>
                <span className={`${styles.bookingFieldLabel} ${landingMonoFont.className}`}>Preferred time</span>
                <input
                  type="time"
                  required
                  value={bookingForm.time}
                  onChange={(event) => handleBookingFieldChange("time", event.target.value)}
                  className={styles.bookingInput}
                />
              </label>
            </div>
            <div className={styles.bookingActions}>
              <button type="button" className={styles.bookingGhostAction} onClick={() => setBookCallOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={styles.bookingPrimaryAction}>
                Send booking request
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <section className={styles.startupRibbonSection}>
        <div className={styles.containerWide}>
          <div data-reveal className={styles.startupRibbonLabel}>
            <span className={landingMonoFont.className}>South African startups that trust us</span>
          </div>
        </div>
        <div data-reveal className={styles.startupMarqueeShell}>
          <div className={styles.startupMarquee} aria-label="Selected South African startup names">
            <div className={styles.startupMarqueeTrack}>
              {startupMarqueeItems.map((name, index) => (
                <span key={`${name}-${index}`} className={styles.startupMarqueeItem}>
                  <span>{name}</span>
                  <span className={styles.startupMarqueeDot} aria-hidden="true" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className={styles.platformSection}>
        <div className={styles.containerWide}>
          <div className={styles.platformGrid}>
            <div className={styles.platformCopy}>
              <div data-reveal className={styles.sectionLabel}>
                <span className={landingMonoFont.className}>BUILT TO STAY OUT OF YOUR WAY</span>
              </div>
              <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
                The product does not scatter.
                <br />
                It stacks.
              </h2>
              <p data-reveal className={styles.sectionIntro}>
                Every tool you need is one click away - not buried in a tab you forgot existed.
              </p>
              <div data-reveal className={styles.featureBullets}>
                <div>
                  <Workflow size={18} />
                  <span>Review and merge tickets without leaving the queue. No tab-switching, no lost context.</span>
                </div>
                <div>
                  <Sparkles size={18} />
                  <span>AI drafts the reply - or sends it. Full auto across every channel, or just a nudge when you need it. You decide how much it does.</span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>Nothing sends silently. Failures, retries, and every sent message are visible to whoever runs the system.</span>
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
            <span className={landingMonoFont.className}>AI-NATIVE. EVERY CHANNEL.</span>
          </div>
          <div className={styles.channelsHeader}>
            <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
              Every channel they use.
              <br />
              One AI that never leaves.
            </h2>
            <p data-reveal className={styles.sectionIntro}>
              Each channel behaves exactly as customers expect. Your AI handles it end-to-end — or steps back the
              moment you want in.
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

      <section className={styles.sequenceSection}>
        <div className={styles.containerWide}>
          <div data-reveal className={styles.sectionLabel}>
            <span className={landingMonoFont.className}>Resolution sequence</span>
          </div>
          <div className={styles.sequenceHeader}>
            <h2 data-reveal className={`${styles.sectionTitle} ${landingDisplayFont.className}`}>
              One path in.
              <br />
              One resolved state out.
            </h2>
            <p data-reveal className={styles.sectionIntro}>
              Email, WhatsApp, and voice collapse into one queue, load context beside the ticket, and resolve through AI or human handoff without resetting the work.
            </p>
          </div>
          <div data-reveal className={styles.sequenceFlowScroller}>
            <div className={styles.sequenceFlowPanel}>
              <div className={`${styles.sequenceFlowBridge} ${styles.sequenceFlowBridgeOne}`} aria-hidden="true" />
              <div className={`${styles.sequenceFlowBridge} ${styles.sequenceFlowBridgeTwo}`} aria-hidden="true" />

              <article className={styles.sequenceFlowStep}>
                <span className={`${styles.sequenceFlowIndex} ${landingMonoFont.className}`}>01</span>
                <div className={styles.sequenceSignalScene}>
                  <div className={`${styles.sequenceSignalCard} ${styles.sequenceSignalCardWhatsapp}`}>
                    <MessageCircleMore size={16} />
                    <span>WhatsApp</span>
                  </div>
                  <div className={`${styles.sequenceSignalCard} ${styles.sequenceSignalCardEmail}`}>
                    <Mail size={16} />
                    <span>Email</span>
                  </div>
                  <div className={`${styles.sequenceSignalCard} ${styles.sequenceSignalCardVoice}`}>
                    <PhoneCall size={16} />
                    <span>Voice</span>
                  </div>
                  <span className={`${styles.sequenceSignalLine} ${styles.sequenceSignalLineTop}`} aria-hidden="true" />
                  <span className={`${styles.sequenceSignalLine} ${styles.sequenceSignalLineMiddle}`} aria-hidden="true" />
                  <span className={`${styles.sequenceSignalLine} ${styles.sequenceSignalLineBottom}`} aria-hidden="true" />
                  <div className={styles.sequenceSignalNode} aria-hidden="true">
                    <span className={styles.sequenceSignalRing} />
                    <span className={styles.sequenceSignalCore} />
                  </div>
                </div>
                <h3 className={styles.sequenceFlowTitle}>Signal captured.</h3>
                <p className={styles.sequenceFlowBody}>
                  Incoming email, WhatsApp, and voice signals collapse into one operating queue the moment they land.
                </p>
              </article>

              <article className={styles.sequenceFlowStep}>
                <span className={`${styles.sequenceFlowIndex} ${landingMonoFont.className}`}>02</span>
                <div className={styles.sequenceContextScene}>
                  <div className={styles.sequenceContextCard}>
                    <div className={styles.sequenceContextHeader}>TKT-2841 · WhatsApp · High</div>
                    <div className={styles.sequenceContextBody}>
                      <div className={styles.sequenceContextIdentity}>
                        <span className={styles.sequenceContextAvatar}>OP</span>
                        <div className={styles.sequenceContextMeta}>
                          <span className={styles.sequenceContextName}>Olivia Parker</span>
                          <span className={styles.sequenceContextSubline}>Enterprise · 14 tickets</span>
                        </div>
                        <span className={`${styles.sequenceContextChip} ${landingMonoFont.className}`}>
                          <Sparkles size={12} />
                          AI resolution
                        </span>
                      </div>
                      <div className={styles.sequenceContextThread}>
                        <span className={styles.sequenceContextThreadLine} />
                        <span className={styles.sequenceContextThreadLineShort} />
                        <span className={styles.sequenceContextThreadLineMuted} />
                      </div>
                      <div className={styles.sequenceContextHistory}>
                        <span className={`${styles.sequenceContextHistoryPill} ${landingMonoFont.className}`}>History</span>
                        <span className={`${styles.sequenceContextHistoryPill} ${landingMonoFont.className}`}>Priority</span>
                        <span className={`${styles.sequenceContextHistoryPill} ${landingMonoFont.className}`}>Owner</span>
                      </div>
                    </div>
                  </div>
                </div>
                <h3 className={styles.sequenceFlowTitle}>Context loaded.</h3>
                <p className={styles.sequenceFlowBody}>
                  The ticket expands with customer identity, thread history, and an AI resolution path before anyone types a word.
                </p>
              </article>

              <article className={styles.sequenceFlowStep}>
                <span className={`${styles.sequenceFlowIndex} ${landingMonoFont.className}`}>03</span>
                <div className={styles.sequenceResolveScene}>
                  <div className={styles.sequenceResolveSplit} aria-hidden="true" />
                  <span className={styles.sequenceResolveBetweenArrow} aria-hidden="true" />
                  <div className={`${styles.sequenceResolveLane} ${styles.sequenceResolveLaneTop}`}>
                    <span className={`${styles.sequenceResolveMode} ${landingMonoFont.className}`}>
                      <Bot size={13} />
                      AI auto-close
                    </span>
                    <span className={styles.sequenceResolveLaneTrack} aria-hidden="true" />
                    <span className={styles.sequenceResolvedState}>Resolved</span>
                  </div>
                  <div className={`${styles.sequenceResolveLane} ${styles.sequenceResolveLaneBottom}`}>
                    <span className={`${styles.sequenceResolveMode} ${landingMonoFont.className}`}>
                      <UserRound size={13} />
                      Human handoff
                    </span>
                    <span className={styles.sequenceResolveLaneTrack} aria-hidden="true" />
                    <span className={styles.sequenceResolvedState}>Resolved</span>
                  </div>
                </div>
                <h3 className={styles.sequenceFlowTitle}>Resolved.</h3>
                <p className={styles.sequenceFlowBody}>
                  AI can close one path automatically. Human operators can take the other. Both end with full context and a clean resolved state.
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.ctaSection}>
        <div className={styles.container}>
          <div className={styles.ctaPanel} data-reveal>
            <p className={`${styles.ctaEyebrow} ${landingMonoFont.className}`}>6esk</p>
            <h2 className={`${styles.ctaTitle} ${landingDisplayFont.className}`}>
              Every signal.
              <br />
              One operating surface.
            </h2>
            <p className={styles.ctaBody}>
              No sales process. No demo lock. Just open it and see if it fits.
            </p>
            <div className={styles.ctaActions}>
              <Link href={demoWorkspaceHref} className={styles.primaryAction} onClick={handleOpenWorkspace}>
                Open Workspace Free
                <ArrowRight className={styles.inlineIcon} />
              </Link>
              <button type="button" className={styles.secondaryAction} onClick={() => setBookCallOpen(true)}>
                Book a call
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerContainer}`}>
          <button
            type="button"
            className={styles.footerAccordionToggle}
            onClick={() => setFooterExpanded((previous) => !previous)}
            aria-expanded={footerExpanded}
            aria-controls="landing-footer-panel"
          >
            <div className={styles.footerAccordionSummary}>
              <div className={styles.footerBrand}>
                <BrandMark size={28} />
              </div>
              <div className={styles.footerSummaryHeadings}>
                {FOOTER_SECTIONS.map((section) => (
                  <span key={section.title} className={`${styles.footerHeading} ${landingMonoFont.className}`}>
                    {section.title}
                  </span>
                ))}
              </div>
              <ChevronDown
                className={cn(styles.footerAccordionChevron, footerExpanded && styles.footerAccordionChevronOpen)}
              />
            </div>
          </button>
          <div
            id="landing-footer-panel"
            className={cn(styles.footerAccordionPanel, footerExpanded && styles.footerAccordionPanelOpen)}
          >
            <div className={styles.footerAccordionPanelInner}>
              <div className={styles.footerGrid}>
                <div className={styles.footerIntro}>
                  <p className={styles.footerTagline}>AI-native support. Every channel. One surface.</p>
                </div>
                <div className={styles.footerColumns}>
                  {FOOTER_SECTIONS.map((section) => (
                    <div key={section.title} className={styles.footerColumn}>
                      <h3 className="sr-only">{section.title}</h3>
                      <ul className={styles.footerLinkList}>
                        {section.items.map((item) => (
                          <li key={`${section.title}-${item.label}`}>
                            {"href" in item && item.href ? (
                              <Link
                                href={item.href === "workspace" ? signInHref : item.href}
                                className={styles.footerLink}
                                onClick={item.href === "workspace" ? handleSignInNavigation : undefined}
                              >
                                {item.label}
                              </Link>
                            ) : (
                              <span className={styles.footerLinkMuted}>{item.label}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
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
