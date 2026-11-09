import { jewelleryMeasurementFields } from "./jewellery-sizing";
export default function JewelleryMeasurementFields({
  values,
  disabled,
  onChange,
}: {
  values: Record<string, string>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      <div className="measurement-grid">
        {jewelleryMeasurementFields.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.options ? (
              <select
                aria-label={f.label}
                disabled={disabled}
                value={values[f.key] || ""}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                <option value="">Not recorded</option>
                {f.options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={f.label}
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={values[f.key] || ""}
                disabled={disabled}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <p className="small-footnote">
        Use millimetres for the selected finger/hand. For bangles, measure the widest knuckles with
        the thumb tucked in, not the wrist. An existing ring’s inner diameter excludes its metal
        band. Indian bangle 2.10 means 2 + 10/16 inches.
      </p>
    </>
  );
}
