# StudyOS: recurrence, exceptions, special days, ICS and sync (read-only analysis)

Worktree `.claude/worktrees/sharing` @ 3bd4b97. Paths are relative to `src/` unless marked otherwise.
DST behaviour was checked by running the real `expandEvents`, `parseIcs` and `buildIcs` with TZ=Europe/Rome and
TZ=America/New_York (a throwaway script outside the repo). The repo was not touched.

## 1. What exists today

### 1.1 Data model
- `CalendarEvent` (types.ts:128-157): `start` and `end` are ISO **UTC instants**. The editor converts input with
  `new Date(local).toISOString()` (CalendarView.tsx:1659-1662, dates.ts:6-10). The event stores **no time zone**.
- `allDay?` (types.ts:144) is stored as the UTC instant of local midnight to the next one (`allDayRange`,
  selectors.ts:60-63). It is not a floating date. Only BARB imports use floating `YYYY-MM-DDT00:00:00`
  (barbReminders.ts:7-15, types.ts:141-142).
- `recurrence?: "none"|"daily"|"weekly"|"monthly"` plus `recurrenceUntil?: YYYY-MM-DD` (types.ts:145-147) is the
  whole model. It has no interval, weekday set, count, yearly, exceptions, overrides, reminders or time zone.
- `sourceUid?` (types.ts:155-156) is the ICS UID for import dedup. `status: "skipped"` exports as
  STATUS:CANCELLED (ics.ts:128).
- `Reminder` (types.ts:262-268, db.ts:66, synced via collections.ts:15) is **dead**. Nothing creates it; it only
  appears in `detachLinked` cascades (useStudyStore.ts:1024, 1090, 1132).
- `Task` (types.ts:159-180) has `dueDate?` as an instant and **no repeat concept**. Tasks export as all-day
  VEVENTs (ics.ts:149-166).
- `EventCategory` (types.ts:114-126) is duplicated as enums in agent/catalog.ts:25, 270, 291 and as an exhaustive
  `Record` in labels.ts:117. SQL stores it as free text.

### 1.2 Expansion (`lib/recurrence.ts`)
- `expandEvents(events, from, to)` (26-70) is pure. A series is **one stored record**; occurrences are never
  persisted (1-2; docs/agent/GOTCHAS.md:35-37).
- Each occurrence is `{...event, start, end = start + baseDuration, occurrenceKey: id@startISO, recurring}`
  (17-23). Extra fields such as `sharedFrom` survive (tests/sharing.test.mjs:492).
- Daily and weekly step with date-fns `addDays` from a skipped-ahead cursor (52-60). Monthly uses
  `addMonths(base, i+1)` with no skip (61-66). `MAX_OCCURRENCES = 1000` per event per call (13). Archived events
  are skipped (32).
- `until` is device-local midnight plus 24h−1ms (46-49), which is off by an hour on DST days.
- Sorting is by string `start.localeCompare` (69; also CalendarView.tsx:311). It only works because every value is
  `Z`-normalised.
- `RECURRENCE_LABEL` (72-77) feeds the editor selects, the hover tag (CalendarView.tsx:1539) and the import preview
  (CalendarTransfer.tsx:220).

### 1.3 Verified behaviour (script output)
| Case | Result | Verdict |
|---|---|---|
| Weekly 10:00 Rome from Mon 19 Oct 2026 across DST end (25 Oct), TZ=Rome | 08:00Z, then 09:00Z: 10:00 Rome every week | OK |
| Same series viewed with TZ=America/New_York | 26 Oct occurrence at **09:00 Rome** (US DST ends 1 Nov) | **Bug.** The wall clock follows the *viewer's* zone |
| Monthly from 31 Jan | 31/1, 28/2, 31/3, 30/4, 31/5, 30/6 (clamped) | Differs from RFC and Google, which skip. Export is plain `FREQ=MONTHLY` (ics.ts:119-127), so Google drops Feb/Apr/Jun |
| All-day weekly series based on 25 Oct (a 25h day) | 1 Nov occurrence ends **2 Nov 01:00** | **Bug.** The grid matches by overlap (CalendarView.tsx:769-775), so the chip also shows on Monday |
| All-day 12 Nov created in Rome, viewed in New York | shows on **11 Nov** | **Bug.** All-day is stored as an instant |
| Export of all-day plus RRULE | `DTSTART;VALUE=DATE:20261112` with `UNTIL=20261231T225959Z` | **RFC violation.** UNTIL must be a DATE (RFC 5545 §3.3.10) |

### 1.4 UI for repeats and exceptions
- **Create modal** (CalendarView.tsx:1956-2200): the repeat select sits under "Altre opzioni" (2129, 2143-2150).
  There is **no "until"**. The draft only has `recurrence` (1946, 1976, 2007).
- **Editor** (`EventEditorModal`, 1605-1940): repeat select plus "Fino al" (1847-1860), validation (1708-1710).
  Subtitle: "le modifiche valgono per tutte le sue date" (1737-1738).
- **No per-occurrence editing.** Clicking an occurrence passes only the series id (`onEditEvent(id, ownerId)`, 180,
  996, 1104, 1217, 1362). The occurrence date is lost.
- **Drag** (time-grid drop 940-950, month drop 1303-1313) goes to `moveEvent` (336-365). It moves the **whole
  series** by the same delta after `window.confirm` (343-346), including on shared series (351-361).
- **Delete** removes the whole series (531-540). Store `deleteEvent` filters a single id
  (useStudyStore.ts:1018-1026).
- **Quick add** (QuickAddModal.tsx:130-150) creates non-repeating 1h "other" events or 50-min study blocks, with no
  repeat option (hint at 295).

## 2. Every place that writes, renders or counts events
- **Store** (useStudyStore.ts):
  - `addEvent` 892-921 whitelists fields. **New fields must be added there**, or they are dropped.
  - `importEvents` 952-1009 dedups by `sourceUid`. The update branch only rewrites
    title/description/start/end/allDay/recurrence/until (966-977). The `seen` set skips a UID repeated in the
    same file (960-962).
  - `updateEvent` 1011-1016 spreads the patch, so unknown fields survive. `deleteEvent` 1018-1026.
  - Also: BARB import 923-950, subject-delete detach 1085, attachment detach 1325.
- **CalendarView.tsx**:
  - Expansion of own plus shared events (304-312). Shared occurrence keys get the owner prefix *after* expansion
    (309).
  - `sharedCalendarEvent` (89-108) spreads untrusted entities and only checks title/start/end.
  - `LINKED_EVENT_FIELDS` (127-130). Shared save sends changed fields over the latest version (550-571). Shared
    create (601-636) sends no until.
  - Renderers: TimeGrid 730-1095 (all-day bucket 769-775), AllDayChip 1097, DayList 1151, EventRow 1211, MonthGrid
    1259-1400 (`isSameDay(start)` 1285), Agenda 1411-1500, preview 1520-1545.
  - SemesterMap counts raw events (2268-2269: archived included, a series counts as 1, weekly only). Already
    flagged in docs/plans/2026-11-11-ux-audit/calendar.md:81.
- **selectors.ts**: `todayEvents` 66-69 and `upcomingEvents` 72-75 (120-day horizon, so a yearly birthday 5 months
  out is missed). Used by DashboardView.tsx:64-68.
- **Agent/MCP** (executes in the browser via the Worker bridge):
  - catalog.ts: list 237-249 ("id = series"), get 251, create 260-279, update 282-303 (enum
    `none|daily|weekly|monthly`), delete 305-312 ("intera serie").
  - execute.ts: `eventOut` 61-76, overview 291 (count) and 309-317, listEvents 457-468, createEvent 470-494,
    updateEvent 496-512 (`pick` whitelist 501).
  - agent/shared.ts: `SHARED_FIELDS.calendarEvent` whitelist (106, **new fields must be added**),
    `occurrenceSource` 213-221, `expandEvents` 241, `SHARED_EDITABLE` 253 (no recurrence).
    sharedTools.ts:164 / shared.ts:311 creates with `recurrence: "none"`.
  - Inputs use `additionalProperties:false` plus enum checks (catalog.ts:36; agent/schema.ts:52, 86). New optional
    params are additive. Never drop the legacy enum values.
- **Sharing**:
  - sharing.ts: `changedFields` with groups (740-746), shared edit merge (1083-1088), `PROTECTED_KEY` (336),
    `sharedBarbExams` keyed by sourceUid+start (905-920).
  - SharedItemDrawer has no event fields. Groups do not carry events.
- **Server validator for recipients' writes** (supabase/sharing.sql:345-480, trigger 549):
  - A saved field **cannot change JSON type** (367-376).
  - `recurrence`, `recurrenceUntil`, `subjectId` and `goalId` must be string or null (449, 466-470). **Keep
    `recurrence` a string forever.** Unknown new keys pass, subject to type stability.
  - On **create**, the text fields must be strings and the lists arrays (447-475). `links` must be `[]` (410-418).
  - The share's subject filter uses `payload->>'subjectId'` (144-150). `sourceUid` is protected (362).
- **Sync, persistence and backup have no validator that rejects new optional fields**:
  - `normalizeCollections` only needs `id` (collections.ts:64-73).
  - `planMerge` is per-entity LWW on `updatedAt` with tombstones (syncMerge.ts:64-144).
  - Push sends the whole entity (cloudSync.ts:239-240). Persistence diffs by reference (persistence.ts:35-54).
    Backup normalises the same way (backup.ts:74).
  - Dexie indexes only id/start/end/category/subjectId/status/priority (db.ts:58). New fields on `events` need no
    Dexie version or `SYNC_SCHEMA` bump (cloudSync.ts:47). Those are only for new *collections* (GOTCHAS.md).
- **ICS UI**: CalendarTransfer.tsx 60-125 (recurring count 78, payload 86-100, 5 MB cap 14).

## 3. `lib/ics.ts` today
- **Export (`buildIcs`, 71-170)**:
  - UID is `sourceUid ?? id@studyos` (104).
  - Timed events use `DTSTART;TZID=<device zone>` from Intl wall time (17-30, 77-86). **No VTIMEZONE**, although
    RFC 5545 §3.2.19 requires one per TZID. Google and Apple accept IANA names; Outlook may not.
  - All-day `VALUE=DATE` uses the device-local date of the instant (105-110), so it is the wrong day from another
    zone (verified: NY gives 20261111).
  - RRULE is only `FREQ=DAILY|WEEKLY|MONTHLY` plus `UNTIL=<local 23:59:59>Z` (119-127). Nothing else: no INTERVAL,
    BYDAY, COUNT, EXDATE, RECURRENCE-ID or VALARM. All-day UNTIL is DATE-TIME. Monthly days 29-31 clamp in-app
    but skip in Google.
  - Exams export as 2h events (132-147), tasks as all-day TRANSPARENT (149-166).
- **Import (`parseIcs`, 288-430)**: VEVENT only, with VALARM and other nested blocks skipped (295, 419-424).
  - DTSTART: Z, IANA TZID through the two-pass `zonedToUtc` (228-249), floating as device-local, DATE as local
    midnight (251-272).
  - Windows TZIDs **silently** fall back to device-local. Verified: on a NY device, "W. Europe Standard Time"
    10:00 became 15:00Z instead of 09:00Z.
  - VTIMEZONE is ignored. CANCELLED events are dropped (306).
  - **RECURRENCE-ID: the override VEVENT is dropped** with a warning (307-310).
  - `INTERVAL≠1` or YEARLY imports **the first date only** with a warning (347-351). A 29 Feb birthday becomes one
    1992 event.
  - **EXDATE is ignored** with a warning (352). COUNT becomes an UNTIL day (362-381).
  - **WEEKLY BYDAY on several days is split into N series** with UID `uid#<weekday>` (383-399). Verified:
    `BYDAY=MO,WE,FR;COUNT=6` became `d#1`, `d#3`, `d#5`.
  - **MONTHLY;BYDAY=1MO silently becomes "monthly on DTSTART's date"**, because BYDAY is parsed only for weekly
    (360). BYMONTHDAY, BYSETPOS and WKST are silently ignored. Cap of 2000 events (286).
- **Round-trip hazards**:
  - A legacy split re-exports `UID:d#1`.
  - A new parser that keeps BYDAY together would **not match** the stored `d#1/d#3/d#5` on re-import: 1 new series
    plus 3 legacy series means **duplicates**. Adopt and replace `X#n` events when importing UID `X`.
  - The store's `seen` set (useStudyStore.ts:960-962) would drop a RECURRENCE-ID VEVENT, which shares its master's
    UID. Key on uid plus recurrence-id.

## 4. Reminders and notifications
- **There is no per-event reminder.** `Reminder` is never created, and `src` has no Notification API,
  `showNotification` or push code.
- `public/sw.js` handles only install, activate, fetch and message (45, 55, 104, 150). It has no `push` or
  `notificationclick` handler.
- The only reminder is the in-app task-timer toast (components/TaskTimerReminder.tsx, AppShell.tsx:423), which works
  only while the app is open.
- `AppNotification` (types.ts:315-325) is an in-app inbox.
- Web Push is **designed, not built**: Worker `/push`, VAPID, subscriptions table and SQL triggers
  (docs/plans/2026-11-11-people-search-push-design.md:111-183).
  - It is event-triggered. Timed event reminders also need a scheduler (Worker cron or pg_cron) that reads
    reminder times, which are already plaintext in Supabase (§8).
  - Until then, the honest promise is "promemoria quando l'app è aperta". iOS needs the installed PWA.

## 5. Existing tests
- calendarLogic.test.mjs:29-78 covers single/weekly/until/daily/monthly/archived. Its DST assertion (35-47) uses
  device-local constructors, so it **cannot catch the viewer-zone bug**.
- allDay.test.mjs:29-105 covers the flag, `allDayRange`, expansion keeping allDay, VALUE=DATE export and import.
- studyFeatures.test.mjs:99-197:
  - export with TZID plus weekly UNTIL (99-130)
  - import of TZID, BYDAY split, COUNT, DURATION and VALARM (132-184)
  - monthly round trip (186-195)
- barbExamImport.test.mjs:58-100 checks floating BARB all-day through ICS.
- sharing.test.mjs:492-500 covers `sharedFrom` on occurrences; 536-545 covers recurrence `changedFields` groups.
- agent.test.mjs:485, 610 checks that a malformed shared event is tolerated.
- Runner: `node --import ./scripts/lib/register-ts.mjs --test tests/*.test.mjs` (package.json:12) with no TZ pinned.
  **New tests must pass an explicit `timeZone`** and also run under `TZ=America/New_York`.

## 6. Risks for a new model
1. **Type stability.**
   - Making `recurrence` an object breaks recipients' writes (sharing.sql:367-376, 449, 466-470), old PWAs, agent
     enums and `RECURRENCE_LABEL` lookups.
   - Keep `recurrence`/`recurrenceUntil` as a legacy projection and add new fields.
2. **Rendering.** All views consume `expandEvents` (CalendarView.tsx:304-312, selectors.ts:66-75,
   execute.ts:309/467, agent/shared.ts:241).
   - Overrides must be joined *inside* the expander, keyed by `owner + seriesId`, because shared lists mix owners
     (307 vs 309). Otherwise every view shows duplicates.
   - Floating all-day strings break string sorting (recurrence.ts:69). Sort by ms.
3. **Counts** ("serie ricorrente = 1 voce", ux-calendar-timer-design.md:37). Raw `events.length` appears at
   SettingsView.tsx:605, CalendarView.tsx:2268-2269 and execute.ts:291. Exclude `seriesId` rows and group
   `splitFrom` chains.
4. **Sharing.**
   - Overrides must copy the master's `subjectId`. Otherwise they vanish for subject-filtered shares
     (sharing.sql:144-150) while the master instance stays visible.
   - Recipient-created overrides need `links: []`.
   - Every rule field belongs in one `LINKED_EVENT_FIELDS` group.
   - Other people's rules are **untrusted**: validate and cap them before expanding (DoS via COUNT, interval 0).
5. **LWW per entity** (syncMerge.ts:133-141).
   - Inline structures on the master (exdate list, override map) lose concurrent edits from two devices or from
     owner plus recipient.
   - A split writes 2 rows. If another device later edits the old master, its version wins *without* the new
     UNTIL, so both series run: **duplicates**. Revision restore (sharing.sql:587-626) can resurrect a pre-split
     master the same way.
6. **Deletes.** `deleteEvent` is single-id. A series delete must cascade tombstones to overrides and split
   children. Orphan overrides that arrive later must be hidden.
7. **MCP.**
   - Occurrences expose only the series id (execute.ts:61-76). Add `occurrenceDate` and `seriesId`, plus
     `scope: all|this|following` on update and delete.
   - Keep the legacy enum and add `repeat` and `rrule`.
   - Update `SHARED_FIELDS` (shared.ts:106) and the `pick` whitelist (execute.ts:501).
8. **Behaviour drift.**
   - Switching legacy monthly from clamp to RFC skip would remove occurrences users already see. Keep clamp,
     which is RFC-encodable as `BYMONTHDAY=28,29,30;BYSETPOS=-1`.
   - Pinning legacy events to a zone they never recorded would move them.
9. **ICS re-import duplicates** from the legacy `uid#n` split (§3).

## 7. Recommended model (additive, no destructive migration)
```ts
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export interface RepeatRule {                 // RFC 5545 RRULE subset, stored structured + validated
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;                          // 1..99; quarterly = monthly×3, half-yearly = monthly×6
  byWeekday?: Weekday[];                      // Mon/Wed/Fri in ONE event
  monthly?: { by: "day" } | { by: "lastDay" } // RFC skip / BYMONTHDAY=-1
          | { by: "clampDay" }                // legacy: BYMONTHDAY=28..D;BYSETPOS=-1
          | { by: "weekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: Weekday }; // "primo lunedì", "ultimo venerdì"
  yearlyLeap?: "feb28" | "mar1" | "skip";     // 29 Feb starts; default feb28 (BYMONTH=2;BYMONTHDAY=-1)
  end?: { type: "never" } | { type: "until"; date: string /* YYYY-MM-DD, event zone, inclusive */ }
                          | { type: "count"; count: number /* 1..999, DTSTART = #1 */ };
  wkst?: Weekday;                             // default MO
  sourceRRule?: string;                       // imported RRULE with unmodelled parts: exported verbatim, UI read-only
}
export interface EventReminder { minutesBefore?: number; daysBefore?: number; at?: string /* HH:mm, all-day */ }
export interface CalendarEvent extends BaseEntity {
  /* existing fields unchanged; recurrence/recurrenceUntil always rewritten as the best legacy projection */
  repeat?: RepeatRule;          // authoritative when repeatLegacy still matches
  repeatLegacy?: string;        // `${recurrence}|${recurrenceUntil ?? ""}` at write: an old client editing recurrence
                                // creates a mismatch => legacy wins, repeat ignored and dropped on next save
  timeZone?: string;            // IANA captured at creation; absent = device zone (exact legacy semantics)
  seriesId?: ID;                // override row (= RECURRENCE-ID); deterministic id `${seriesId}@${originalDate}`
  originalDate?: string;        // YYYY-MM-DD of the replaced instance in series zone: our subset never yields
                                // 2 instances per day, so the key survives whole-series time changes
  cancelled?: true;             // deleted instance (= EXDATE); also archived:true so old builds skip it
  splitFrom?: ID;               // "this and following" child; the expander ends the parent before it
  occasion?: { kind: "birthday" | "anniversary" | "holiday" | "recurring-day"; birthYear?: number; person?: string };
  reminders?: EventReminder[];  // VALARM on export; in-app firing until push plus a scheduler exist
  sourceRecurrenceId?: string;  // imported RECURRENCE-ID (dedup key = uid+rid; sourceUid stays the master UID)
}
```

### 7.1 Decisions behind the model
- **Overrides and exceptions** are separate full-snapshot rows with deterministic ids, not inline maps.
  - Edits to *different* instances on two devices write different rows, so nothing is lost.
  - Edits to the *same* instance converge on one id, so nothing is duplicated.
  - A cancelled override also sets `archived:true`. Old builds already skip archived rows (recurrence.ts:32,
    ics.ts:99), so a deleted instance never reappears on a stale PWA. Modified overrides do show twice there until
    the service worker updates (sw.js:4, 10-minute precache refresh). That is acceptable.
  - The snapshot copies `subjectId`, and recipients create it with `links: []`. Subject is series-level: changing
    it rewrites the overrides in the same commit.
- **"This and following"** is a series split.
  - The parent's end becomes the previous day (or `count` = instances before the split).
  - A child is created with `splitFrom` and `count` = remaining instances. It gets no `sourceUid`.
  - Later overrides are re-keyed to the child (delete plus create). Modified overrides are dropped if the time of
    day changed, as Google does; say so in the confirmation.
  - The expander also ends the parent at the child's first instance, so the result does not depend on write order
    (risk 5).
  - Splitting at the first instance is the same as editing the whole series.
- **Delete scopes:**
  - "Only this" creates a cancelled override.
  - "This and following" truncates the series.
  - "Whole series" tombstones the master, its overrides and (after asking) its split children.
- **Time zones:**
  - Timed events expand as wall clock in `timeZone`: civil-date stepping, then `zonedToUtc`. Move that function
    out of ics.ts:228-249 into `lib/tz.ts`.
  - In the DST gap, 02:30 becomes 03:30. In the repeated hour, use the first instance. Display stays in the
    viewer's zone.
  - New all-day events, and every `occasion`, use floating `YYYY-MM-DDT00:00:00` as BARB already does. Occurrences
    are emitted floating, which fixes the 25h-day and wrong-day bugs.
  - Events without `timeZone` keep today's exact semantics.
- **Birthdays and anniversaries:**
  - Use `category: "personal"`, so old clients, labels.ts:117 and the agent enums stay valid. `occasion.kind`
    drives the icon and colour.
  - All-day, yearly rule, optional `birthYear` (age computed per occurrence), one or more `reminders`, `notes`.
  - 29 Feb follows `yearlyLeap`. The dashboard needs a 366-day `nextOccurrence`, not the 120-day `upcomingEvents`.
- **Migration** is read-time only.
  - `normalizeRepeat(event)` maps the legacy shape (monthly → `clampDay`) and writes back only on the user's save.
  - Saves write `repeat`, `repeatLegacy`, `timeZone` and the legacy projection. Mon/Wed/Fri becomes `"weekly"`,
    which old builds show on DTSTART's weekday only (degraded but safe). Yearly becomes `"none"`.
  - No Dexie, SYNC_SCHEMA or SQL change is required.
- **Store and UI:**
  - `addEvent` copies the new fields (useStudyStore.ts:892-921).
  - New actions `editOccurrence` and `deleteOccurrence(seriesId, originalDate, scope)`, each one `set` plus one
    `commit`.
  - `onEditEvent` and drag must pass the occurrence (CalendarView.tsx:180, 336-365).
  - Progressive editor: title, date, time and type first; repeat, end condition, reminders and details go in
    collapsible sections (the current "Altre opzioni" pattern, 2129). A dedicated "Compleanno / ricorrenza" flow
    pre-sets all-day, yearly, the icon and a day-before reminder.

### 7.2 Pure functions and tests

Functions:
- `lib/tz.ts`: `zonedToUtc`, `utcToZonedParts`, civil add-days and add-months.
- `lib/repeat.ts`:
  - rule handling: `normalizeRepeat`, `validateRepeat`, `legacyProjection`
  - expansion: `expandRule(rule, wallStart, zone, from, to)` and `expandEvents(…, {groupKey})` with the override
    join and split truncation
  - queries: `nextOccurrence`, `countBefore`, `describeRule` (IT: "Ogni 2 settimane lun, mer, ven, fino al 18 dic")
  - edits: `planEdit(series, overrides, originalDate, scope, patch)` returning `{puts, deletes}`, and `planSplit`
  - helpers: `ageOn`, `reminderInstants`
- `lib/ics.ts`: `toRRule`, `fromRRule` (returns `{rule, unsupported[]}`), EXDATE / RECURRENCE-ID / VALARM /
  VTIMEZONE output, Windows→IANA map.

Test cases:
1. Weekly 10:00 Europe/Rome from 19 Oct 2026 gives 08:00Z then 09:00Z, identically under TZ=Rome, UTC and New York.
2. DST gap and overlap: daily 02:30 on 29 Mar 2026 gives 03:30 CEST; daily 02:30 on 25 Oct gives 00:30Z.
3. Monthly from 31 Jan:
   - `day` gives 31 Jan, 31 Mar, 31 May.
   - `lastDay` gives 31 Jan, 28 Feb, 31 Mar, 30 Apr.
   - `clampDay` matches today's output.
4. 29 Feb 2000 birthday: `feb28` gives 28 Feb 2027 and 29 Feb 2028; `skip` gives leap years only;
   `ageOn(2000, 2027-02-28)` = 27.
5. Nth weekday: 1MO gives 2 Nov, 7 Dec, 4 Jan; −1FR gives 27 Nov, 25 Dec, 29 Jan.
6. Weekly MO,WE,FR every 2 weeks from 2 Nov gives 2, 4, 6, 16, 18, 20 Nov. Also cover WKST with a Wednesday
   DTSTART.
7. COUNT:
   - COUNT=6 MO,WE,FR ends Fri 13 Nov.
   - A Tuesday DTSTART with BYDAY=MO,WE still counts as #1; the UI should snap DTSTART to a matching day.
8. UNTIL is inclusive in the event zone. Timed export gives `UNTIL=<end of local day>Z`; all-day gives
   `UNTIL=YYYYMMDD`.
9. Overrides:
   - A cancelled override hides its instance.
   - A moved override leaves its day and appears on the new one, even outside the window or past the rule end.
   - An orphan override is hidden. Two overrides with the same id converge.
10. Split:
    - Splitting a COUNT=10 series at #3 gives parent COUNT=2 and child COUNT=8.
    - The union of instances is unchanged (property test).
    - A stale parent without its new end is still truncated by the child.
11. RRULE round trip for `WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL`, `MONTHLY;BYDAY=1MO`, `MONTHLY;BYDAY=-1FR`,
    `MONTHLY;INTERVAL=3`, `MONTHLY;INTERVAL=6` and `YEARLY;COUNT=5`. BYSETPOS and BYHOUR are kept in `sourceRRule`
    with a warning.
12. ICS:
    - Export then import keeps EXDATE (value type and TZID match DTSTART), a same-UID RECURRENCE-ID override and
      a VALARM.
    - Re-importing our own export does not duplicate.
    - The legacy `X#1/X#3` events are adopted.
    - A Windows TZID resolves correctly on a NY device.
13. Legacy fixtures expanded over 2 years in Rome and in New York match today's `expandEvents` exactly.
14. A `repeatLegacy` mismatch (an old build set `recurrence: "none"`) means the rule is ignored.
15. `validateRepeat` rejects interval 0, −1 or 1e9, count 1e9 and bogus weekdays. Expansion stays at most 1000 per
    call.
16. An all-day weekly series based on 25 Oct gives one-day instances. A floating birthday falls on the same date in
    every zone.
17. `reminderInstants` handles 15 minutes before a timed event and "1 day before at 09:00" for an all-day event, in
    the event's zone.

## 8. Real sync vs subscription feed
- **Two-way Google/Apple sync is not feasible here.**
  - Google needs an OAuth client with the sensitive `calendar` scope (app verification), server-side refresh
    tokens, sync tokens and push channels on a verified domain, plus instance mapping.
  - Apple needs CalDAV with iCloud app-specific passwords (handling user credentials) or our own CalDAV server.
  - The app is a PWA plus Supabase, and the Worker is only an MCP bridge. Keep the UI honest: "file .ics, non
    sincronizzazione" (ux-calendar-timer-design.md:46-52).
- **Cloud data is not end-to-end encrypted.**
  - Payloads are plaintext JSONB; `encrypted` is forced false (supabase/schema.sql:11-12, 156; README.md:33;
    docs/cloud-sync-architecture.md:32-35).
  - The vault encrypts only the local IndexedDB copy (persistence.ts:193-198), and backups optionally
    (backup.ts:35). `crypto.ts` is not used for sync.
  - Sharing depends on the server reading `subjectId` and `sourceUid` (sharing.sql:139-150). A server-rendered
    feed therefore breaks no E2E promise, because none exists.
- **The Worker** (worker/index.ts:1-65) is a single Durable Object, `getByName("owner")`, running `HttpHub`.
  - Routes: /mcp, OAuth, /pair, /bridge/* (agent/httpHub.ts:234-390). Env holds only `HUB` and `STUDYOS_PAIR_KEY`
    (index.ts:5-8).
  - It has **no Supabase credentials and no user data**. Tools execute in the user's browser.
- **Option A (recommended): a snapshot published by the client.**
  - The app renders only its *own* events with `buildIcs`. Never include other people's shared items; notes and
    links are optional.
  - It sends a debounced `PUT /feed/<token>`, authenticated with the bridge token. The Worker stores the file in
    DO storage and serves `GET /cal/<token>.ics` as `text/calendar` with an ETag, routed in index.ts before the
    hub.
  - No database key on the Worker. The feed is stale until the app runs, and Google refreshes about every 8-24 h;
    say so.
  - With the single "owner" DO there is one feed per deployment unless the DO is keyed per user.
- **Option B (not worth it for read-only):** the Worker queries Supabase with the service-role key by token. It
  puts a full-database key on the Worker and needs a token table plus an RLS bypass.
- **Security for either option:**
  - The URL is a **bearer secret**: at least 128 random bits, revocable and rotatable. Rate-limit the GET.
  - Google and Apple servers, their logs, and anyone who receives the link see plaintext. Show "chiunque abbia il
    link vede questi eventi".
  - Default to titles and times only.
  - Importing a Google "secret iCal address" needs a Worker fetch proxy (Google sends no CORS headers). Allow only
    `calendar.google.com` and `*.icloud.com`, with size limits, to prevent SSRF.
