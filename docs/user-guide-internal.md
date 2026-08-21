# Team Guide — Running Donations Day to Day

> **Who this is for:** The Beauty Forward team handling donations. It covers what reaches
> you, how to answer the donor questions you'll get, the one situation that needs you to
> act, and when to hand something to your technical contact.
>
> You don't need any technical background, and you don't need to touch the code or the
> database.

---

## Your two tools

You work in **two dashboards**:

- **💳 Givebutter** — to see whether a donor's contribution actually went through.
- **🚚 Roadie** — to see where a courier is, and to book or rebook one.

That's it. Everything else the app does — recording donations, sending emails, deciding
when to book a courier — happens **automatically in the background.** You don't start it
and you can't see it directly.

> **What you *don't* touch:** the donation database (in Firebase). The team doesn't have
> access to it and doesn't need it. Anything that requires looking *inside* a donation
> record goes to your **technical contact** — see *When to escalate.*

---

## What actually reaches you

Most donations need nothing from you — they complete on their own and the donor gets an
automatic email. You get involved in only a few situations:

1. **A donor has a question** ("did it go through?", "where's my courier?").
2. **A pickup's courier didn't get booked** — the one case that needs action.
3. **A physical donation arrives** — a shipped box at the warehouse, or someone at the
   front desk for a drop-off.

Each is covered below.

---

## Answering donor questions

| The donor says… | What to do |
| --- | --- |
| **"Did my donation go through?"** | Check **Givebutter** for their contribution (search by email/amount). If it's there, they're all set. |
| **"I donated but didn't get an email."** | Emails are automatic but not instant. If their payment shows in Givebutter, reassure them it's recorded. If they *never* got any email, flag it to your technical contact — email delivery may need a look. |
| **"Where's my courier?"** | Check **Roadie** for their pickup. Roadie sends its own driver texts, so point them there too. Late/cancelled drivers are a Roadie matter. |
| **"I paid but no pickup was scheduled."** | The important one — see *The one situation that needs you* below. |
| **"Can I change or cancel my pickup?"** | Handle it in **Roadie** (reschedule/cancel the courier). There's no self-service for the donor. |
| **"I'm going to ship my items."** | They mail items themselves to the warehouse and should email you their **tracking number**. Watch for the package. |
| **"I want to drop items off."** | Their confirmation email has the **drop-off location and hours** (Mon–Fri, 9 AM–5 PM). They leave the package at the front desk saying it's for Beauty Forward. |

---

## The one situation that needs you: paid, but no courier

This is the only case where the system needs a human. It happens when a donor's
**payment succeeded but the courier didn't get booked** (a Roadie hiccup, a bad address,
an outage at the wrong moment).

**How you'll find out:** usually the donor tells you ("I paid, nothing's scheduled"). The
app also automatically emails these donors a **"we're on it" reassurance note**, so they
may mention that.

**How to confirm and fix it:**

1. **Check Givebutter** — did their contribution actually go through? (If not, they
   simply never finished paying — there's nothing to rebook. Tell them to complete their
   contribution; the app will also send a reminder.)
2. **Check Roadie** — is there a courier booked for them? If payment went through but
   **no courier exists**, that's this case.
3. **Book the courier in Roadie yourself** — you have access. That gets the pickup to the
   donor.
4. **Tell your technical contact** you rebooked, so they can tidy the donation's record
   behind the scenes. *(Booking in Roadie by hand doesn't update the app's records — the
   donor is served either way, but the tech contact closes the loop.)*

> **A pattern to watch:** one of these now and then is a normal hiccup. **Several in a
> short span** suggests something bigger (a Roadie outage or a bad warehouse setting) —
> escalate rather than rebooking one by one.

---

## The automatic emails donors will mention

The app sends these on its own. Knowing they exist helps you answer donors:

| Email | Who gets it | When |
| --- | --- | --- |
| **Confirmation** | Every donor | Right after they finish (pickups: once their payment is confirmed) |
| **"Finish your donation" reminder** | Pickup donors who never completed payment | The day after they started |
| **"We're on it" reassurance** | Pickup donors whose payment cleared but courier didn't book | Within an hour of the problem |

You don't send any of these — but if a donor references one, this table tells you what
they're talking about.

---

## Receiving physical donations

**Shipped packages:** donors mail items to the warehouse themselves. They should email
you a tracking number — keep an eye out for the delivery. There's no prepaid label and no
courier involved.

**Drop-offs:** the donor arrives during opening hours (Mon–Fri, 9 AM–5 PM) and leaves the
package at the front desk for Beauty Forward. Their confirmation email has the location
and hours. No courier, no payment.

---

## When to escalate (and what to include)

Send it to your **technical contact** when:

- A donor's **payment shows in Givebutter but nothing seems to have happened** for days
  (this can be a rare "lost payment" case only they can trace).
- A donor got **no email at all**, ever.
- You're seeing **several failed courier bookings** in a short window.
- Anything that would require looking **inside the app's database.**

**When you escalate, include:** the donor's **name and email**, roughly **when** they
donated, **which method** (pickup / ship / drop-off), and **what they're seeing**. That's
enough for the technical contact to find the record.

---

## Quick reference

| Question | Go to |
| --- | --- |
| Did they pay? | **Givebutter** |
| Where's the courier? / rebook one | **Roadie** |
| Anything inside the donation record | **Technical contact** |

**The golden rule:** if payment went through but no courier was booked, **rebook it in
Roadie** — that's the one thing that's yours to fix. Everything deeper goes to your
technical contact.
