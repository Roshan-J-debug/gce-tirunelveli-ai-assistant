function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
}) {
  const base =
    "px-4 py-2 rounded-lg font-medium transition duration-200";

  const variants = {
    primary:
      "bg-blue-700 text-white hover:bg-blue-800",

    secondary:
      "bg-gray-200 text-gray-800 hover:bg-gray-300",

    danger:
      "bg-red-600 text-white hover:bg-red-700",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export default Button;