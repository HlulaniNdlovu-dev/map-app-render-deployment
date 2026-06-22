// 1. Base Scores & Category Definitions
const RISK_CATEGORIES = {
    VIOLENT_CRIME: { 
        name: "Violent Crime", 
        baseScore: 8,
        examples: [
            "Active hijacking hotspots",
            "armed robbery"
        ] 
    },
    CIVIL_UNREST: { 
        name: "Civil Unrest", 
        baseScore: 6,
        examples: [
            "Localized protests", 
            "no-go zones", 
            "taxi strikes"
        ]
    },
    ENVIRONMENTAL_HAZARDS: { 
        name: "Environmental Hazards", 
        baseScore: 3,
        examples: [
            "Major accidents", 
            "road closures", 
            "severe flooding"
        ] 
    },
    INFRASTRUCTURE_ISSUES: { 
        name: "Infrastructure Issues", 
        baseScore: 1,
        examples: [
            "Poor lighting", 
            "load shedding", 
            "signals out", 
            "high pothole density"
        ] 
    }
};

function getRecencyScore(minutesAgo) {
    if (minutesAgo >= 0 && minutesAgo <= 30) {
        return 2; // 30 mins ago = +2
    } else if (minutesAgo > 30 && minutesAgo <= 120) {
        return 1; // 30-120 mins ago = +1
    }
    return 0;
}


function getColorCoding(score) {
    if (score >= 7) return { severity: "High Risk", color: "RED" };
    if (score === 6) return { severity: "Medium-High Risk", color: "ORANGE" };
    if (score >= 3 && score <= 5) return { severity: "Medium Risk", color: "YELLOW" };
    if (score >= 1 && score <= 2) return { severity: "Low Risk", color: "LIME" };
    return { severity: "No Risk", color: "GREEN" };
}


function calculateAreaRisk(baseCategory, minutesAgo, historicScoresInArea = [], decayRate = 0.5) {
    
    const recencyWeight = getRecencyScore(minutesAgo);
    const currentRiskScore = baseCategory.baseScore + recencyWeight;

    let historicRiskScore = 0;
    if (historicScoresInArea.length > 0) {
        const sumOfHistoric = historicScoresInArea.reduce((acc, score) => acc + score, 0);
        historicRiskScore = sumOfHistoric / historicScoresInArea.length;
    }

    let overallRiskScore = currentRiskScore + (historicRiskScore * decayRate);

    overallRiskScore = Math.max(0, overallRiskScore); 

    const visualCoding = getColorCoding(Math.round(overallRiskScore));

    return {
        category: baseCategory.name,
        currentRiskScore: currentRiskScore,
        historicRiskScore: parseFloat(historicRiskScore.toFixed(2)),
        overallRiskScore: parseFloat(overallRiskScore.toFixed(2)),
        assessment: visualCoding.severity,
        displayColor: visualCoding.color
    };
}

export { calculateAreaRisk, RISK_CATEGORIES, getColorCoding };