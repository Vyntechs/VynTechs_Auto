revoke all privileges
  on table
    public.tickets,
    public.ticket_jobs,
    public.job_attachments,
    public.job_lines,
    public.canned_jobs,
    public.quote_versions,
    public.quote_events,
    public.vendor_accounts
  from anon, authenticated;
