# Accumulation

The stop hook reviews tasks exceeding 30 completed turns in a background Session. It asks
for candidate findings through `kb_propose`, with applicable conditions and actual trace
evidence. It does not publish through `kb_ingest`. When more than one library accepts
contributions, a target must be selected explicitly; ambiguous automatic extraction skips.

Human owners review pending candidates independently of the original Session at
`/api/projects/<projectId>/knowledge-bases/manage`. Accepted candidates become searchable;
rejected candidates remain outside retrieval. Reviewing an already handled candidate
returns a conflict. The view has a pending count and refresh; OS push notifications and a
main-app navigation entry have not been implemented.
