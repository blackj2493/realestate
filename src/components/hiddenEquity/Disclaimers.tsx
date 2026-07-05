export default function Disclaimers() {
  return (
    <div className="space-y-1 rounded-md border border-border bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
      <p>
        This is an automated estimate generated from aggregate market data —{" "}
        <span className="text-muted-foreground">not an appraisal</span> or professional opinion of value.
      </p>
      <p>Information herein is deemed reliable but is not guaranteed accurate by PROPTX.</p>
      <p>
        The information provided herein must only be used by consumers that have a bona fide
        interest in the purchase, sale, or lease of real estate and may not be used for any
        commercial purpose or any other purpose.
      </p>
    </div>
  );
}
