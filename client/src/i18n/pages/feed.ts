// Seitenweise Übersetzungen für den Feed (Aktivitäts-Stream) — DE + EN.
// ALLE Item-Texte werden clientseitig aus type + Rohdaten übersetzt.
export const feed = {
  de: {
    feed: {
      title: 'Feed',
      subtitle: 'Alles auf einen Blick — Ihr Aktivitäts-Stream.',
      autoUpdated: 'aktualisiert sich automatisch',
      loadError: 'Feed konnte nicht geladen werden.',
      retry: 'Erneut versuchen',
      checkNow: 'Jetzt prüfen',
      actionBadge: 'Aktion nötig',
      tabs: {
        all: 'Alles',
        tasks: 'Warnungen & Aufgaben',
        team: 'Team',
        personal: 'Persönlich',
      },
      groups: {
        today: 'Heute',
        thisWeek: 'Diese Woche',
        upcoming: 'Demnächst',
      },
      kpi: {
        presentNow: 'Anwesend jetzt',
        presentNowValue: '{{present}} / {{total}}',
        myBalance: 'Mein Saldo',
        openTasks: 'Offene Aufgaben',
        todayWorked: 'Heutige Ist-Zeit',
      },
      empty: {
        title: 'Noch nichts Neues',
        text: 'Sobald gestempelt wird, Anträge entschieden werden oder etwas im Team ansteht, erscheint es hier automatisch.',
      },
      source: {
        web: 'Web',
        terminal: 'Terminal',
        manual: 'Nachtrag',
        api: 'API',
        auto_cap: 'Auto-Kappung',
      },
      item: {
        stamp_status: {
          title_in: 'Sie sind eingestempelt',
          title_break: 'Sie sind in der Pause',
          title_out: 'Sie sind ausgestempelt',
          since: 'seit {{time}} Uhr',
          desc: 'Heutige Ist-Zeit: {{worked}} · Soll: {{target}}',
        },
        balance: {
          title: 'Ihr Zeitkonto: {{balance}}',
          desc: 'Kumulierter Saldo bis {{date}}',
        },
        correction_own_pending: {
          title: 'Ihr Korrekturantrag für den {{date}} ist eingereicht',
          desc: 'Der Antrag wartet auf eine Entscheidung.',
        },
        correction_own_decided: {
          title_approved: 'Ihr Korrekturantrag für den {{date}} wurde genehmigt',
          title_rejected: 'Ihr Korrekturantrag für den {{date}} wurde abgelehnt',
          descNote: 'Anmerkung: {{note}}',
        },
        day_warning: {
          title_incomplete: 'Gestern nicht ausgestempelt',
          title_auto_capped: 'Gestern wurde Ihre Zeit automatisch gekappt',
          desc: 'Für den {{date}} bitte eine Korrektur beantragen.',
        },
        presence_summary: {
          title: '{{present}} anwesend · {{onBreak}} in Pause · {{absent}} abwesend',
          desc: 'Anwesenheit jetzt ({{total}} Mitarbeiter)',
        },
        stamp_event: {
          title_in: '{{name}} ist gekommen',
          title_out: '{{name}} ist gegangen',
          desc: '{{time}} Uhr · Quelle: {{source}}',
        },
        missing_out: {
          title: '{{name}} hat sich gestern nicht ausgestempelt',
          desc: 'Tag {{date}} ist unvollständig — bitte prüfen bzw. nachtragen.',
        },
        correction_open: {
          title: 'Offener Korrekturantrag von {{name}}',
          desc: 'Für den {{date}}: „{{message}}“',
        },
        arbzg_violation: {
          title: 'ArbZG-Hinweis: {{name}}',
          desc: '{{date}}: {{flags}}',
          flag_arbzg_over_10h: 'mehr als 10 Stunden gearbeitet',
          flag_arbzg_rest_violation: 'Ruhezeit unterschritten',
        },
        terminal_issue: {
          title_inactive: 'Terminal „{{name}}“ ist deaktiviert',
          title_stale: 'Terminal „{{name}}“ meldet sich nicht',
          descSeen: 'Zuletzt gesehen: {{time}}',
          descNever: 'Noch nie online gewesen.',
          location: 'Standort: {{location}}',
        },
        timesheet_upload: {
          title: 'Stundenzettel für {{name}} hochgeladen',
          desc: '{{fileName}} · Zeitraum {{start}} – {{end}}',
        },
        month_open: {
          title: 'Monatsabschluss {{month}} steht noch aus',
          desc: '{{company}}: Der Vormonat ist noch nicht abgeschlossen.',
        },
        sync_result: {
          title_ok: 'UrlaubsFeed-Abgleich erfolgreich',
          title_error: 'UrlaubsFeed-Abgleich fehlgeschlagen',
          desc_ok: '{{set}} Abwesenheitstage übernommen, {{cleared}} entfernt.',
          desc_error: 'Fehler: {{error}}',
        },
        absence: {
          title_self: 'Ihre Abwesenheit: {{label}}',
          title_other: '{{name}} ist abwesend: {{label}}',
          descRange: '{{start}} – {{end}}',
          descDay: 'am {{start}}',
        },
        holiday: {
          title: 'Feiertag: {{name}}',
          desc: 'am {{date}}',
          company: 'Betriebsfeiertag',
        },
        anniversary: {
          title_one: '{{name}} feiert 1 Jahr im Unternehmen',
          title_many: '{{name}} feiert {{years}} Jahre im Unternehmen',
          desc: 'am {{date}} — herzlichen Glückwunsch!',
        },
        new_colleague: {
          title: '{{name}} ist neu im Team',
          desc: 'dabei seit {{date}} — herzlich willkommen!',
        },
      },
      dashboardCard: {
        title: 'Neuestes aus dem Feed',
        toFeed: 'Zum Feed',
        empty: 'Keine offenen Aufgaben — alles im grünen Bereich.',
      },
    },
  },
  en: {
    feed: {
      title: 'Feed',
      subtitle: 'Everything at a glance — your activity stream.',
      autoUpdated: 'updates automatically',
      loadError: 'The feed could not be loaded.',
      retry: 'Try again',
      checkNow: 'Review now',
      actionBadge: 'Action required',
      tabs: {
        all: 'All',
        tasks: 'Warnings & tasks',
        team: 'Team',
        personal: 'Personal',
      },
      groups: {
        today: 'Today',
        thisWeek: 'This week',
        upcoming: 'Coming up',
      },
      kpi: {
        presentNow: 'Present now',
        presentNowValue: '{{present}} / {{total}}',
        myBalance: 'My balance',
        openTasks: 'Open tasks',
        todayWorked: 'Worked today',
      },
      empty: {
        title: 'Nothing new yet',
        text: 'As soon as someone clocks in, requests are decided or something comes up in the team, it will appear here automatically.',
      },
      source: {
        web: 'Web',
        terminal: 'Terminal',
        manual: 'Manual entry',
        api: 'API',
        auto_cap: 'Auto cap',
      },
      item: {
        stamp_status: {
          title_in: 'You are clocked in',
          title_break: 'You are on a break',
          title_out: 'You are clocked out',
          since: 'since {{time}}',
          desc: 'Worked today: {{worked}} · Target: {{target}}',
        },
        balance: {
          title: 'Your time account: {{balance}}',
          desc: 'Cumulative balance up to {{date}}',
        },
        correction_own_pending: {
          title: 'Your correction request for {{date}} was submitted',
          desc: 'The request is awaiting a decision.',
        },
        correction_own_decided: {
          title_approved: 'Your correction request for {{date}} was approved',
          title_rejected: 'Your correction request for {{date}} was rejected',
          descNote: 'Note: {{note}}',
        },
        day_warning: {
          title_incomplete: 'You did not clock out yesterday',
          title_auto_capped: 'Your time was automatically capped yesterday',
          desc: 'Please request a correction for {{date}}.',
        },
        presence_summary: {
          title: '{{present}} present · {{onBreak}} on break · {{absent}} absent',
          desc: 'Presence right now ({{total}} employees)',
        },
        stamp_event: {
          title_in: '{{name}} clocked in',
          title_out: '{{name}} clocked out',
          desc: '{{time}} · Source: {{source}}',
        },
        missing_out: {
          title: '{{name}} did not clock out yesterday',
          desc: 'Day {{date}} is incomplete — please review or add the entry.',
        },
        correction_open: {
          title: 'Open correction request from {{name}}',
          desc: 'For {{date}}: “{{message}}”',
        },
        arbzg_violation: {
          title: 'Working time notice: {{name}}',
          desc: '{{date}}: {{flags}}',
          flag_arbzg_over_10h: 'worked more than 10 hours',
          flag_arbzg_rest_violation: 'rest period not met',
        },
        terminal_issue: {
          title_inactive: 'Terminal “{{name}}” is deactivated',
          title_stale: 'Terminal “{{name}}” is not reporting',
          descSeen: 'Last seen: {{time}}',
          descNever: 'Never been online.',
          location: 'Location: {{location}}',
        },
        timesheet_upload: {
          title: 'Timesheet uploaded for {{name}}',
          desc: '{{fileName}} · Period {{start}} – {{end}}',
        },
        month_open: {
          title: 'Month-end closing {{month}} is still open',
          desc: '{{company}}: The previous month has not been closed yet.',
        },
        sync_result: {
          title_ok: 'UrlaubsFeed sync succeeded',
          title_error: 'UrlaubsFeed sync failed',
          desc_ok: '{{set}} absence days applied, {{cleared}} removed.',
          desc_error: 'Error: {{error}}',
        },
        absence: {
          title_self: 'Your absence: {{label}}',
          title_other: '{{name}} is absent: {{label}}',
          descRange: '{{start}} – {{end}}',
          descDay: 'on {{start}}',
        },
        holiday: {
          title: 'Public holiday: {{name}}',
          desc: 'on {{date}}',
          company: 'Company holiday',
        },
        anniversary: {
          title_one: '{{name}} celebrates 1 year with the company',
          title_many: '{{name}} celebrates {{years}} years with the company',
          desc: 'on {{date}} — congratulations!',
        },
        new_colleague: {
          title: '{{name}} is new to the team',
          desc: 'joined on {{date}} — welcome aboard!',
        },
      },
      dashboardCard: {
        title: 'Latest from the feed',
        toFeed: 'Go to feed',
        empty: 'No open tasks — all clear.',
      },
    },
  },
};
