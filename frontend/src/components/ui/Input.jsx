function Input({
  placeholder,
  value,
  onChange,
}) {
  return (
    <input
      className="w-full border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  );
}

export default Input;