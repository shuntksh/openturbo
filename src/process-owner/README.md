# Process containment

OT uses one native containment boundary for each workflow. OT normally creates
and owns this boundary.

An external process owner can set `OT_PROCESS_CONTAINMENT=inherited` when it
starts OT. This value is a launcher contract. It is not workflow configuration.
The external owner makes these guarantees:

- It contains OT before OT code starts.
- Every OT descendant inherits the same native containment boundary.
- It forwards cancellation to that boundary.
- It does not return terminal control until the boundary is empty.

OT then starts workflow commands inside the inherited boundary. It does not
create a second POSIX process group or Windows Job Object.

On POSIX systems, the owner must put OT in the process group that it cancels.
On Windows, the owner must put OT in a Job Object that lets descendants inherit
membership. The owner must use kill-on-close or an equivalent cleanup rule.

Do not set `OT_PROCESS_CONTAINMENT` in `workflows.json`, package scripts, or
workflow command environments. A false declaration removes OT's independent
containment and can let child processes survive.
