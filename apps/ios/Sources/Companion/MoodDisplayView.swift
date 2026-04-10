import ShittimChestKit
import SwiftUI

// MARK: - Compact Mood Pill (for StatusPill area or overlay)

/// A compact pill showing Arona's current mood with emoji and intensity bar.
/// Designed to sit alongside StatusPill or in a floating overlay.
struct CompanionMoodPill: View {
    let state: ShittimChestEmotionalState

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        HStack(spacing: 8) {
            Text(state.mood.emoji)
                .font(.system(size: 18))

            VStack(alignment: .leading, spacing: 2) {
                Text(state.mood.displayName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)

                // Intensity bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(.white.opacity(0.15))
                            .frame(height: 3)

                        Capsule()
                            .fill(moodColor.opacity(0.9))
                            .frame(width: geo.size.width * state.intensity, height: 3)
                    }
                }
                .frame(width: 50, height: 3)
            }

            // Affection hearts (compact — just the count)
            HStack(spacing: 1) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(affectionColor)
                Text("\(state.affectionLevel.rawValue)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            .white.opacity(self.contrast == .increased ? 0.5 : 0.18),
                            lineWidth: self.contrast == .increased ? 1.0 : 0.5)
                }
                .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
        }
    }

    private var moodColor: Color {
        Color(hex: state.mood.accentColorHex) ?? .white
    }

    private var affectionColor: Color {
        switch state.affectionLevel {
        case .stranger: .gray
        case .acquaintance: .blue
        case .friend: .green
        case .closeFriend: .orange
        case .bestFriend: .pink
        }
    }
}

// MARK: - Full Mood Card (for settings or detail view)

/// Expanded mood display card showing all mood details.
struct CompanionMoodCard: View {
    let state: ShittimChestEmotionalState

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header: Mood + Emoji
            HStack(spacing: 12) {
                Text(state.mood.emoji)
                    .font(.system(size: 40))

                VStack(alignment: .leading, spacing: 4) {
                    Text(state.mood.displayName)
                        .font(.title2.weight(.bold))

                    Text(state.mood.displayNameVI)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Intensity badge
                Text(state.intensityLabel.capitalized)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background {
                        Capsule().fill(moodColor.opacity(0.2))
                    }
                    .foregroundStyle(moodColor)
            }

            // Intensity bar
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Intensity")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(String(format: "%.0f%%", state.intensity * 100))
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(.quaternary)
                            .frame(height: 6)

                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [moodColor.opacity(0.6), moodColor],
                                    startPoint: .leading,
                                    endPoint: .trailing))
                            .frame(width: geo.size.width * state.intensity, height: 6)
                            .animation(.spring(response: 0.5), value: state.intensity)
                    }
                }
                .frame(height: 6)
            }

            // Affection
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Affection")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(state.affectionLevel.displayName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 4) {
                    ForEach(1...5, id: \.self) { level in
                        Image(systemName: level <= state.affectionLevel.rawValue ? "heart.fill" : "heart")
                            .font(.system(size: 16))
                            .foregroundStyle(
                                level <= state.affectionLevel.rawValue
                                    ? .pink
                                    : .quaternary)
                    }
                    Spacer()
                    Text("\(Int(state.affection))/100")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }

            // Sensei perception (if available)
            if let senseiMood = state.senseiMood {
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "eye.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Arona thinks Sensei is:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(senseiMood.emoji)
                        .font(.system(size: 16))
                    Text(senseiMood.displayName)
                        .font(.caption.weight(.semibold))
                }
            }

            // Triggers
            if !state.triggers.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recent triggers")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)

                    FlowLayout(spacing: 4) {
                        ForEach(state.triggers, id: \.self) { trigger in
                            Text(trigger)
                                .font(.system(size: 10, weight: .medium))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background {
                                    Capsule().fill(.quaternary)
                                }
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            // Reflection reason
            if let reason = state.lastReflectionReason {
                HStack(spacing: 6) {
                    Image(systemName: "thought.bubble")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(.white.opacity(0.15), lineWidth: 0.5)
                }
                .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
        }
    }

    private var moodColor: Color {
        Color(hex: state.mood.accentColorHex) ?? .white
    }
}

// MARK: - FlowLayout (simple horizontal wrapping)

private struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var height: CGFloat = 0
        for (i, row) in rows.enumerated() {
            let maxH = row.map(\.sizeThatFits(.unspecified).height).max() ?? 0
            height += maxH
            if i < rows.count - 1 { height += self.spacing }
        }
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            let maxH = row.map(\.sizeThatFits(.unspecified).height).max() ?? 0
            for view in row {
                let size = view.sizeThatFits(.unspecified)
                view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + self.spacing
            }
            y += maxH + self.spacing
        }
    }

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [[LayoutSubviews.Element]] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[LayoutSubviews.Element]] = [[]]
        var currentX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if currentX + size.width > maxWidth, !rows[rows.count - 1].isEmpty {
                rows.append([])
                currentX = 0
            }
            rows[rows.count - 1].append(view)
            currentX += size.width + self.spacing
        }
        return rows
    }
}

// MARK: - Color hex helper

extension Color {
    init?(hex: String) {
        var hexStr = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hexStr.hasPrefix("#") { hexStr.removeFirst() }
        guard hexStr.count == 6, let value = UInt64(hexStr, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255.0,
            green: Double((value >> 8) & 0xFF) / 255.0,
            blue: Double(value & 0xFF) / 255.0)
    }
}
